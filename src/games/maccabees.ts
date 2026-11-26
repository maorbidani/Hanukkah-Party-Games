import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface FallingProjectile {
  id: number;
  side: PlayerSide;
  kind: 'arrow' | 'fireball';
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  vx: number;
  vy: number;
  radius: number;
  angle: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  alpha: number;
  vy: number;
}

interface ShieldState {
  nx: number;
  ny: number;
  prevNx: number;
  prevNy: number;
  active: boolean;
  activeGrace: number;
  flashAlpha: number;
}

export class MaccabeesGame {
  private projectiles: FallingProjectile[] = [];
  private sparks: Spark[] = [];
  private popups: FloatingText[] = [];
  private shields: Record<PlayerSide, ShieldState> = {
    left: { nx: 0.25, ny: 0.72, prevNx: 0.25, prevNy: 0.72, active: false, activeGrace: 0, flashAlpha: 0 },
    right: { nx: 0.75, ny: 0.72, prevNx: 0.75, prevNy: 0.72, active: false, activeGrace: 0, flashAlpha: 0 },
  };
  private nextId = 1;
  private spawnTimer = 0.35;

  public reset(): void {
    this.projectiles = [];
    this.sparks = [];
    this.popups = [];
    this.shields = {
      left: { nx: 0.25, ny: 0.72, prevNx: 0.25, prevNy: 0.72, active: false, activeGrace: 0, flashAlpha: 0 },
      right: { nx: 0.75, ny: 0.72, prevNx: 0.75, prevNy: 0.72, active: false, activeGrace: 0, flashAlpha: 0 },
    };
    this.nextId = 1;
    this.spawnTimer = 0.3;
  }

  private spawnPair(): void {
    const isFireball = Math.random() < 0.42;
    const localOffset = 0.08 + Math.random() * 0.34;
    const fallSpeed = 0.3 + Math.random() * 0.16;
    const drift = (Math.random() - 0.5) * 0.06;

    const sides: PlayerSide[] = ['left', 'right'];
    for (const side of sides) {
      const startX = side === 'left' ? localOffset : 1 - localOffset;
      const vx = side === 'left' ? drift : -drift;
      this.projectiles.push({
        id: this.nextId++,
        side,
        kind: isFireball ? 'fireball' : 'arrow',
        x: startX,
        y: -0.05,
        vx,
        vy: fallSpeed,
        radius: isFireball ? 0.028 : 0.024,
        angle: Math.atan2(fallSpeed, vx),
      });
    }
  }

  private segmentIntersectsEllipse(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number
  ): boolean {
    const axp = (ax - cx) / rx;
    const ayp = (ay - cy) / ry;
    const bxp = (bx - cx) / rx;
    const byp = (by - cy) / ry;
    const abx = bxp - axp;
    const aby = byp - ayp;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, -(axp * abx + ayp * aby) / lenSq)) : 0;
    const clX = axp + t * abx;
    const clY = ayp + t * aby;
    return clX * clX + clY * clY <= 1;
  }

  private spawnBlockSparks(xPx: number, yPx: number, kind: 'arrow' | 'fireball'): void {
    for (let i = 0; i < 24; i++) {
      const angle = -Math.PI + Math.random() * Math.PI * 2;
      const speed = 110 + Math.random() * 280;
      this.sparks.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        size: 3 + Math.random() * 4.5,
        color:
          i % 3 === 0
            ? '#FFFFFF'
            : kind === 'fireball'
            ? '#FB923C'
            : i % 2 === 0
            ? '#FACC15'
            : '#38BDF8',
        alpha: 1,
      });
    }

    this.popups.push({
      x: xPx,
      y: yPx - 24,
      text: '+1',
      alpha: 1,
      vy: -80,
    });
  }

  public update(
    dt: number,
    width: number,
    height: number,
    motion: MotionDetector,
    scores: PlayerScores
  ): boolean {
    let scoreChanged = false;
    const aspect = width / Math.max(1, height);

    // Update shield positions from palm center (Landmark 9) / pointer
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const sh = this.shields[side];
      sh.prevNx = sh.nx;
      sh.prevNy = sh.ny;
      sh.flashAlpha = Math.max(0, sh.flashAlpha - dt * 3.2);

      const pos = motion.getPrimaryHandPos(side);
      if (pos) {
        sh.nx = pos.normX;
        sh.ny = pos.normY;
        sh.activeGrace = 0.55;
        sh.active = true;
      } else {
        sh.activeGrace = Math.max(0, sh.activeGrace - dt);
        sh.active = sh.activeGrace > 0;
      }
    });

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnPair();
      this.spawnTimer = 0.72 + Math.random() * 0.45;
    }

    const shieldBaseR = 0.045;
    const hitRadiusX = shieldBaseR * 3.0; // 3x wide hitbox!
    const hitRadiusY = shieldBaseR * aspect * 3.0;

    const remaining: FallingProjectile[] = [];

    for (const proj of this.projectiles) {
      const prevY = proj.y;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      const minX = proj.side === 'left' ? 0.04 : 0.54;
      const maxX = proj.side === 'left' ? 0.46 : 0.96;
      if (proj.x < minX) {
        proj.x = minX;
        proj.vx = Math.abs(proj.vx);
      } else if (proj.x > maxX) {
        proj.x = maxX;
        proj.vx = -Math.abs(proj.vx);
      }
      proj.angle = Math.atan2(proj.vy, proj.vx);

      if (proj.y > 1.08) {
        continue;
      }

      const sh = this.shields[proj.side];
      let blocked = false;

      if (proj.y > 0.1) {
        // Check continuous shield sweep + projectile fall (only when hand/pointer is active) + general hand sweep motion
        const shieldSweepHit =
          sh.active &&
          this.segmentIntersectsEllipse(
            sh.prevNx,
            sh.prevNy,
            sh.nx,
            sh.ny,
            proj.x,
            proj.y,
            hitRadiusX,
            hitRadiusY
          );
        const projSweepHit =
          sh.active &&
          this.segmentIntersectsEllipse(
            proj.x,
            prevY,
            proj.x,
            proj.y,
            sh.nx,
            sh.ny,
            hitRadiusX,
            hitRadiusY
          );
        const regionHit = motion.getRegionMotion(proj.x, proj.y, hitRadiusX, hitRadiusY) > 0.12;

        if (shieldSweepHit || projSweepHit || regionHit) {
          blocked = true;
          scores[proj.side] += 1;
          scoreChanged = true;
          sh.flashAlpha = 1.0;
          soundEngine.playShieldBlock();
          this.spawnBlockSparks(proj.x * width, proj.y * height, proj.kind);
        }
      }

      if (!blocked) {
        remaining.push(proj);
      }
    }

    this.projectiles = remaining;

    // Update sparks
    const activeSparks: Spark[] = [];
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 320 * dt;
      s.alpha -= 1.8 * dt;
      if (s.alpha > 0.02) activeSparks.push(s);
    }
    this.sparks = activeSparks;

    // Update +1 popups
    const activePopups: FloatingText[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.4 * dt;
      if (pop.alpha > 0.02) activePopups.push(pop);
    }
    this.popups = activePopups;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const now = performance.now();

    // Draw falling arrows & fireballs
    for (const proj of this.projectiles) {
      const cx = proj.x * width;
      const cy = proj.y * height;
      const r = Math.max(12, proj.radius * width);

      ctx.save();
      ctx.translate(cx, cy);
      if (proj.kind === 'arrow') {
        this.drawArrow(ctx, r, proj.angle);
      } else {
        this.drawFireball(ctx, r, now, proj.id);
      }
      ctx.restore();
    }

    // Draw each player's glowing Maccabee Shield
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const sh = this.shields[side];
      const sx = sh.nx * width;
      const sy = sh.ny * height;
      const shieldR = Math.max(40, width * 0.044);
      this.drawMaccabeeShield(ctx, sx, sy, shieldR, side, sh.flashAlpha, now);

      if (!sh.active) {
        const halfW = width * 0.5;
        const msgX =
          side === 'left'
            ? Math.max(76, Math.min(halfW - 76, sx))
            : Math.max(halfW + 76, Math.min(width - 76, sx));
        const fontSize = Math.max(12, Math.min(18, Math.round(width * 0.022)));
        ctx.save();
        ctx.font = `700 ${fontSize}px Rubik, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(9, 18, 44, 0.85)';
        const msg = 'הניעו יד כדי להזיז את המגן!';
        ctx.strokeText(msg, msgX, sy + shieldR + 28, width * 0.44);
        ctx.fillStyle = '#BAE6FD';
        ctx.fillText(msg, msgX, sy + shieldR + 28, width * 0.44);
        ctx.restore();
      }
    });

    // Draw metallic sparks
    for (const s of this.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw +1 popups
    for (const pop of this.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.alpha);
      ctx.font = '800 36px Fredoka, Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.88)';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = '#4ADE80';
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }

  private drawMaccabeeShield(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    side: PlayerSide,
    flashAlpha: number,
    now: number
  ): void {
    const pulse = 1 + Math.sin(now * 0.008) * 0.05;
    const isLeft = side === 'left';

    ctx.save();
    ctx.translate(x, y);

    // Outer luminous energy aura
    const auraR = r * (1.55 + flashAlpha * 0.45) * pulse;
    const aura = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, auraR);
    aura.addColorStop(
      0,
      flashAlpha > 0.1
        ? `rgba(255, 255, 255, ${0.4 + flashAlpha * 0.5})`
        : isLeft
        ? 'rgba(56, 189, 248, 0.35)'
        : 'rgba(251, 191, 36, 0.35)'
    );
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Shield body
    const bodyGrad = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
    if (isLeft) {
      bodyGrad.addColorStop(0, '#38BDF8');
      bodyGrad.addColorStop(0.65, '#1D4ED8');
      bodyGrad.addColorStop(1, '#1E3A8A');
    } else {
      bodyGrad.addColorStop(0, '#FBBF24');
      bodyGrad.addColorStop(0.65, '#B45309');
      bodyGrad.addColorStop(1, '#78350F');
    }

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Thick golden metallic rim
    ctx.strokeStyle = flashAlpha > 0.2 ? '#FFFFFF' : '#FDE047';
    ctx.lineWidth = Math.max(5, r * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Star of David emblem in center of shield
    ctx.strokeStyle = '#FEF9C3';
    ctx.lineWidth = Math.max(2.5, r * 0.07);
    const starR = r * 0.55;
    for (let t = 0; t < 2; t++) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3 + (t === 0 ? -Math.PI / 2 : Math.PI / 2);
        const px = Math.cos(a) * starR;
        const py = Math.sin(a) * starR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Impact flash ring
    if (flashAlpha > 0.05) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.25 + (1 - flashAlpha) * 0.55), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawArrow(ctx: CanvasRenderingContext2D, r: number, angle: number): void {
    ctx.save();
    ctx.rotate(angle);

    const len = r * 2.4;

    // Wooden shaft
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = Math.max(4, r * 0.26);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len * 0.65, 0);
    ctx.lineTo(len * 0.45, 0);
    ctx.stroke();

    // Fletching feathers at tail
    ctx.fillStyle = '#FB7185';
    ctx.beginPath();
    ctx.moveTo(-len * 0.65, 0);
    ctx.lineTo(-len * 0.9, -r * 0.45);
    ctx.lineTo(-len * 0.45, -r * 0.14);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-len * 0.65, 0);
    ctx.lineTo(-len * 0.9, r * 0.45);
    ctx.lineTo(-len * 0.45, r * 0.14);
    ctx.closePath();
    ctx.fill();

    // Gleaming metallic arrowhead
    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(len * 0.85, 0);
    ctx.lineTo(len * 0.3, -r * 0.48);
    ctx.lineTo(len * 0.42, 0);
    ctx.lineTo(len * 0.3, r * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawFireball(ctx: CanvasRenderingContext2D, r: number, now: number, id: number): void {
    const flicker = 1 + Math.sin(now * 0.02 + id) * 0.15;

    // Blazing trail upward
    const trailGrad = ctx.createLinearGradient(0, -r * 2.4, 0, r * 0.6);
    trailGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
    trailGrad.addColorStop(0.55, 'rgba(249, 115, 22, 0.75)');
    trailGrad.addColorStop(1, 'rgba(250, 204, 21, 0.95)');
    ctx.fillStyle = trailGrad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, 0);
    ctx.quadraticCurveTo(0, -r * 2.8 * flicker, r * 0.85, 0);
    ctx.closePath();
    ctx.fill();

    // Fireball core
    const coreGrad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.1);
    coreGrad.addColorStop(0, '#FEF9C3');
    coreGrad.addColorStop(0.55, '#F97316');
    coreGrad.addColorStop(1, '#DC2626');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }
}
