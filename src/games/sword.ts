import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface ChargingSoldier {
  id: number;
  side: PlayerSide;
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  vx: number;
  vy: number; // downward running speed
  radius: number; // normalized to canvas width
  runPhase: number;
  leanAngle: number;
  graceFrames: number;
}

interface TrailNode {
  x: number;
  y: number;
  tipX: number;
  tipY: number;
  alpha: number;
}

interface SwordState {
  nx: number;
  ny: number;
  prevNx: number;
  prevNy: number;
  angle: number;
  tipNx: number;
  tipNy: number;
  prevTipNx: number;
  prevTipNy: number;
  active: boolean;
  activeGrace: number;
  flashAlpha: number;
  trail: TrailNode[];
}

interface StarBurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  color: string;
  alpha: number;
  isStar: boolean;
}

interface FlyingHelmet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotSpeed: number;
  size: number;
  alpha: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
}

const STAR_COLORS = ['#FACC15', '#38BDF8', '#FB7185', '#4ADE80', '#FFFFFF'];

export class SwordGame {
  private soldiers: ChargingSoldier[] = [];
  private particles: StarBurstParticle[] = [];
  private helmets: FlyingHelmet[] = [];
  private popups: FloatingText[] = [];
  private swords: Record<PlayerSide, SwordState> = {
    left: {
      nx: 0.25,
      ny: 0.68,
      prevNx: 0.25,
      prevNy: 0.68,
      angle: -0.45,
      tipNx: 0.22,
      tipNy: 0.52,
      prevTipNx: 0.22,
      prevTipNy: 0.52,
      active: false,
      activeGrace: 0,
      flashAlpha: 0,
      trail: [],
    },
    right: {
      nx: 0.75,
      ny: 0.68,
      prevNx: 0.75,
      prevNy: 0.68,
      angle: 0.45,
      tipNx: 0.78,
      tipNy: 0.52,
      prevTipNx: 0.78,
      prevTipNy: 0.52,
      active: false,
      activeGrace: 0,
      flashAlpha: 0,
      trail: [],
    },
  };
  private nextId = 1;
  private spawnTimer = 0.25;
  private elapsed = 0;

  public reset(): void {
    this.soldiers = [];
    this.particles = [];
    this.helmets = [];
    this.popups = [];
    this.swords = {
      left: {
        nx: 0.25,
        ny: 0.68,
        prevNx: 0.25,
        prevNy: 0.68,
        angle: -0.45,
        tipNx: 0.22,
        tipNy: 0.52,
        prevTipNx: 0.22,
        prevTipNy: 0.52,
        active: false,
        activeGrace: 0,
        flashAlpha: 0,
        trail: [],
      },
      right: {
        nx: 0.75,
        ny: 0.68,
        prevNx: 0.75,
        prevNy: 0.68,
        angle: 0.45,
        tipNx: 0.78,
        tipNy: 0.52,
        prevTipNx: 0.78,
        prevTipNy: 0.52,
        active: false,
        activeGrace: 0,
        flashAlpha: 0,
        trail: [],
      },
    };
    this.nextId = 1;
    this.spawnTimer = 0.2;
    this.elapsed = 0;
  }

  /**
   * Spawns mirrored squads of 2–4 Greek soldiers charging down from top to bottom.
   */
  private spawnSquadWave(): void {
    const squadSize = this.elapsed > 22 ? (Math.random() < 0.45 ? 4 : 3) : Math.random() < 0.55 ? 3 : 2;
    const speedRamp = Math.min(0.24, this.elapsed * 0.0045);
    const baseDownSpeed = 0.22 + speedRamp + Math.random() * 0.08;

    // Pick spread-out horizontal offsets within a half (0.07..0.43)
    const anchors: number[] = [];
    const bandWidth = 0.34 / squadSize;
    for (let i = 0; i < squadSize; i++) {
      const localOffset = 0.08 + i * bandWidth + Math.random() * (bandWidth * 0.65);
      anchors.push(Math.min(0.43, Math.max(0.07, localOffset)));
    }

    const sides: PlayerSide[] = ['left', 'right'];
    for (let i = 0; i < squadSize; i++) {
      const offset = anchors[i];
      const startY = -0.06 - i * 0.055 - Math.random() * 0.03;
      const driftVx = (Math.random() - 0.5) * 0.05;
      const vy = baseDownSpeed * (0.94 + Math.random() * 0.14);
      const phase = Math.random() * Math.PI * 2;

      for (const side of sides) {
        const startX = side === 'left' ? offset : 1 - offset;
        const vx = side === 'left' ? driftVx : -driftVx;
        this.soldiers.push({
          id: this.nextId++,
          side,
          x: startX,
          y: startY,
          vx,
          vy,
          radius: 0.038,
          runPhase: phase,
          leanAngle: vx * 0.9,
          graceFrames: 3,
        });
      }
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
    if (rx <= 0 || ry <= 0) return false;
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

  private spawnSoldierSlash(xPx: number, yPx: number, radiusPx: number): void {
    // Flying cartoon Greek helmet
    this.helmets.push({
      x: xPx,
      y: yPx - radiusPx * 0.35,
      vx: (Math.random() - 0.5) * 260,
      vy: -(340 + Math.random() * 140),
      rotation: 0,
      rotSpeed: (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 6),
      size: radiusPx * 0.72,
      alpha: 1,
    });

    // Comic explosion of colorful stars + flash sparks
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const speed = 135 + Math.random() * 290;
      this.particles.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 50,
        size: i % 2 === 0 ? 7 + Math.random() * 6 : 4 + Math.random() * 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        color: STAR_COLORS[i % STAR_COLORS.length],
        alpha: 1,
        isStar: i % 2 === 0,
      });
    }

    this.popups.push({
      x: xPx,
      y: yPx - 20,
      text: '+1',
      color: '#4ADE80',
      alpha: 1,
      vy: -90,
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
    this.elapsed += dt;
    const aspect = width / Math.max(1, height);
    const bladeLenPx = Math.max(125, width * 0.125);
    const bladeLenNx = bladeLenPx / Math.max(1, width);
    const bladeLenNy = bladeLenPx / Math.max(1, height);

    // 1. Update each player's Maccabee Sword attached to Landmark 9 palm center + light trail
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const sw = this.swords[side];
      sw.prevNx = sw.nx;
      sw.prevNy = sw.ny;
      sw.prevTipNx = sw.tipNx;
      sw.prevTipNy = sw.tipNy;
      sw.flashAlpha = Math.max(0, sw.flashAlpha - dt * 3.8);

      const pos = motion.getPrimaryHandPos(side);
      if (pos) {
        const dx = pos.normX - sw.nx;
        const dy = pos.normY - sw.ny;
        sw.nx = pos.normX;
        sw.ny = pos.normY;
        sw.activeGrace = 0.55;
        sw.active = true;

        const moveDist = Math.hypot(dx, dy);
        if (moveDist > 0.008) {
          const slashAngle = Math.atan2(dy * height, dx * width) + Math.PI / 2;
          let delta = slashAngle - sw.angle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          sw.angle += delta * Math.min(1, dt * 26);
        } else {
          const restAngle = side === 'left' ? -0.45 : 0.45;
          sw.angle += (restAngle - sw.angle) * Math.min(1, dt * 7);
        }
      } else {
        sw.activeGrace = Math.max(0, sw.activeGrace - dt);
        sw.active = sw.activeGrace > 0;
      }

      const tipDirX = Math.sin(sw.angle);
      const tipDirY = -Math.cos(sw.angle);
      sw.tipNx = sw.nx + tipDirX * bladeLenNx;
      sw.tipNy = sw.ny + tipDirY * bladeLenNy;

      if (sw.active) {
        sw.trail.push({
          x: sw.nx * width,
          y: sw.ny * height,
          tipX: sw.tipNx * width,
          tipY: sw.tipNy * height,
          alpha: 0.9,
        });
        if (sw.trail.length > 14) {
          sw.trail.shift();
        }
      }

      for (let i = sw.trail.length - 1; i >= 0; i--) {
        sw.trail[i].alpha -= dt * 5.2;
        if (sw.trail[i].alpha <= 0.02) {
          sw.trail.splice(i, 1);
        }
      }
    });

    // 2. Spawn squads of charging Greek soldiers from the top
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnSquadWave();
      const baseInterval = Math.max(0.85, 1.95 - this.elapsed * 0.018);
      this.spawnTimer = baseInterval + Math.random() * 0.4;
    }

    // 3. Advance running soldiers downward & detect sword slashes
    const remaining: ChargingSoldier[] = [];

    for (const soldier of this.soldiers) {
      soldier.x += soldier.vx * dt;
      soldier.y += soldier.vy * dt;
      soldier.runPhase += dt * (11 + soldier.vy * 14);
      if (soldier.graceFrames > 0) soldier.graceFrames--;

      // Keep inside player's half
      const minX = soldier.side === 'left' ? 0.05 : 0.55;
      const maxX = soldier.side === 'left' ? 0.45 : 0.95;
      if (soldier.x < minX) {
        soldier.x = minX;
        soldier.vx = Math.abs(soldier.vx);
      } else if (soldier.x > maxX) {
        soldier.x = maxX;
        soldier.vx = -Math.abs(soldier.vx);
      }

      // Escaped off bottom of screen
      if (soldier.y > 1.08) {
        continue;
      }

      let hit = false;
      if (soldier.graceFrames <= 0 && soldier.y > 0.03 && soldier.y < 0.98) {
        const hitboxScale = 2.7;
        const rx = soldier.radius * hitboxScale;
        const ry = soldier.radius * aspect * hitboxScale;
        const sw = this.swords[soldier.side];

        const bladeHit =
          sw.active &&
          (this.segmentIntersectsEllipse(sw.nx, sw.ny, sw.tipNx, sw.tipNy, soldier.x, soldier.y, rx, ry) ||
            this.segmentIntersectsEllipse(sw.prevNx, sw.prevNy, sw.nx, sw.ny, soldier.x, soldier.y, rx, ry) ||
            this.segmentIntersectsEllipse(
              sw.prevTipNx,
              sw.prevTipNy,
              sw.tipNx,
              sw.tipNy,
              soldier.x,
              soldier.y,
              rx,
              ry
            ));

        const regionHit = motion.getRegionMotion(soldier.x, soldier.y, rx, ry) > 0.1;

        if (bladeHit || regionHit) {
          hit = true;
          scores[soldier.side] += 1;
          sw.flashAlpha = 1.0;
          soundEngine.playSwordSlash();
          this.spawnSoldierSlash(soldier.x * width, soldier.y * height, soldier.radius * width);
          scoreChanged = true;
        }
      }

      if (!hit) {
        remaining.push(soldier);
      }
    }

    this.soldiers = remaining;

    // 4. Update flying helmets
    const activeHelmets: FlyingHelmet[] = [];
    for (const h of this.helmets) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.vy += 680 * dt;
      h.rotation += h.rotSpeed * dt;
      h.alpha -= 1.05 * dt;
      if (h.alpha > 0.03) activeHelmets.push(h);
    }
    this.helmets = activeHelmets;

    // 5. Update comic star explosion particles
    const activeParticles: StarBurstParticle[] = [];
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 320 * dt;
      p.rotation += p.rotSpeed * dt;
      p.alpha -= 1.65 * dt;
      if (p.alpha > 0.02) activeParticles.push(p);
    }
    this.particles = activeParticles;

    // 6. Update floating +1 popups
    const activePopups: FloatingText[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.35 * dt;
      if (pop.alpha > 0.02) activePopups.push(pop);
    }
    this.popups = activePopups;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // 1. Draw subtle defense line near bottom so kids know where soldiers charge
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(24, height * 0.92);
    ctx.lineTo(width - 24, height * 0.92);
    ctx.stroke();
    ctx.restore();

    // 2. Draw charging cartoon Greek soldiers running top -> bottom
    for (const soldier of this.soldiers) {
      const cx = soldier.x * width;
      const cy = soldier.y * height;
      const r = Math.max(18, soldier.radius * width);
      const strideBounce = Math.abs(Math.sin(soldier.runPhase)) * r * 0.16;

      ctx.save();
      ctx.translate(cx, cy - strideBounce);
      ctx.rotate(soldier.leanAngle + Math.sin(soldier.runPhase) * 0.06);
      this.drawRunningGreekSoldier(ctx, r, soldier.runPhase);
      ctx.restore();
    }

    // 3. Draw sword light trails & Maccabee Swords attached to each player's palm
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const sw = this.swords[side];
      const isLeft = side === 'left';

      if (sw.trail.length > 1) {
        for (let i = 1; i < sw.trail.length; i++) {
          const prev = sw.trail[i - 1];
          const curr = sw.trail[i];
          const alpha = Math.max(0, curr.alpha * 0.55);

          ctx.save();
          ctx.fillStyle = isLeft
            ? `rgba(56, 189, 248, ${alpha})`
            : `rgba(251, 191, 36, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(prev.tipX, prev.tipY);
          ctx.lineTo(curr.tipX, curr.tipY);
          ctx.lineTo(curr.x, curr.y);
          ctx.closePath();
          ctx.fill();

          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(prev.tipX, prev.tipY);
          ctx.lineTo(curr.tipX, curr.tipY);
          ctx.stroke();
          ctx.restore();
        }
      }

      const sx = sw.nx * width;
      const sy = sw.ny * height;
      const bladeLen = Math.max(125, width * 0.125);
      this.drawMaccabeeSword(ctx, sx, sy, sw.angle, bladeLen, side, sw.flashAlpha);

      if (!sw.active) {
        const halfW = width * 0.5;
        const msgX = isLeft
          ? Math.max(76, Math.min(halfW - 76, sx))
          : Math.max(halfW + 76, Math.min(width - 76, sx));
        const fontSize = Math.max(12, Math.min(18, Math.round(width * 0.022)));
        ctx.save();
        ctx.font = `700 ${fontSize}px Rubik, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(9, 18, 44, 0.85)';
        const msg = 'הניפו יד כדי להניף את החרב!';
        ctx.strokeText(msg, msgX, sy + 52, width * 0.44);
        ctx.fillStyle = '#BAE6FD';
        ctx.fillText(msg, msgX, sy + 52, width * 0.44);
        ctx.restore();
      }
    });

    // 4. Draw flying defeated helmets
    for (const h of this.helmets) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, h.alpha);
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rotation);
      this.drawGreekHelmet(ctx, h.size);
      ctx.restore();
    }

    // 5. Draw comic star burst particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.isStar) {
        this.drawFivePointStar(ctx, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 6. Draw +1 popups
    for (const pop of this.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.alpha);
      ctx.font = '800 38px Fredoka, Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.88)';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }

  private drawMaccabeeSword(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    bladeLen: number,
    side: PlayerSide,
    flashAlpha: number
  ): void {
    const isLeft = side === 'left';
    const glowColor = isLeft ? '#38BDF8' : '#FACC15';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.shadowColor = flashAlpha > 0.2 ? '#FFFFFF' : glowColor;
    ctx.shadowBlur = 18 + flashAlpha * 16;

    const bladeGrad = ctx.createLinearGradient(-12, 0, 12, 0);
    bladeGrad.addColorStop(0, isLeft ? '#BAE6FD' : '#FEF08A');
    bladeGrad.addColorStop(0.5, '#FFFFFF');
    bladeGrad.addColorStop(1, isLeft ? '#38BDF8' : '#F59E0B');

    ctx.fillStyle = bladeGrad;
    ctx.strokeStyle = isLeft ? '#0284C7' : '#B45309';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-10, -8);
    ctx.lineTo(-9, -bladeLen * 0.78);
    ctx.lineTo(0, -bladeLen);
    ctx.lineTo(9, -bladeLen * 0.78);
    ctx.lineTo(10, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -bladeLen * 0.88);
    ctx.stroke();

    const guardGrad = ctx.createLinearGradient(-26, 0, 26, 0);
    guardGrad.addColorStop(0, '#B45309');
    guardGrad.addColorStop(0.5, '#FEF08A');
    guardGrad.addColorStop(1, '#B45309');
    ctx.fillStyle = guardGrad;
    ctx.strokeStyle = '#78350F';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-26, -12, 52, 12, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLeft ? '#1E3A8A' : '#7C2D12';
    ctx.beginPath();
    ctx.roundRect(-6, 0, 12, 24, 4);
    ctx.fill();

    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.arc(0, 28, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawGreekHelmet(ctx: CanvasRenderingContext2D, r: number): void {
    // Red horsehair crest plume on top
    ctx.fillStyle = '#E11D48';
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.58, Math.PI, 0);
    ctx.lineTo(r * 0.35, -r * 0.25);
    ctx.lineTo(-r * 0.35, -r * 0.25);
    ctx.closePath();
    ctx.fill();

    const helmGrad = ctx.createLinearGradient(-r, -r, r, r);
    helmGrad.addColorStop(0, '#FEF08A');
    helmGrad.addColorStop(0.5, '#D97706');
    helmGrad.addColorStop(1, '#78350F');
    ctx.fillStyle = helmGrad;
    ctx.strokeStyle = '#451A03';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, Math.PI, 0);
    ctx.lineTo(r * 0.72, r * 0.58);
    ctx.lineTo(r * 0.24, r * 0.58);
    ctx.lineTo(r * 0.18, r * 0.12);
    ctx.lineTo(-r * 0.18, r * 0.12);
    ctx.lineTo(-r * 0.24, r * 0.58);
    ctx.lineTo(-r * 0.72, r * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawRunningGreekSoldier(ctx: CanvasRenderingContext2D, r: number, runPhase: number): void {
    const legSwing = Math.sin(runPhase) * r * 0.36;
    const altLegSwing = -legSwing;

    // 1. Running speed lines / motion dust above soldier
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 1.15);
    ctx.lineTo(-r * 0.35, -r * 1.48);
    ctx.moveTo(r * 0.35, -r * 1.1);
    ctx.lineTo(r * 0.35, -r * 1.42);
    ctx.stroke();
    ctx.restore();

    // 2. Animated running legs & sandals
    ctx.strokeStyle = '#FDBA74';
    ctx.lineWidth = Math.max(4, r * 0.18);
    ctx.lineCap = 'round';

    // Left leg
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, r * 0.66);
    ctx.lineTo(-r * 0.26, r * 0.92 + legSwing * 0.55);
    ctx.stroke();
    ctx.fillStyle = '#78350F';
    ctx.beginPath();
    ctx.ellipse(-r * 0.26, r * 0.96 + legSwing * 0.55, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(r * 0.22, r * 0.66);
    ctx.lineTo(r * 0.26, r * 0.92 + altLegSwing * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(r * 0.26, r * 0.96 + altLegSwing * 0.55, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Long Greek Spear (חנית) held in right arm pointing forward/downward
    const spearBob = Math.sin(runPhase * 2) * r * 0.05;
    ctx.save();
    ctx.translate(r * 0.55, r * 0.22 + spearBob);
    ctx.rotate(0.24);
    // Wooden shaft
    ctx.strokeStyle = '#92400E';
    ctx.lineWidth = Math.max(3, r * 0.11);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.85);
    ctx.lineTo(0, r * 0.95);
    ctx.stroke();
    // Sharp metallic spearhead pointing down
    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.24);
    ctx.lineTo(-r * 0.14, r * 0.86);
    ctx.lineTo(r * 0.14, r * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 4. Cartoon armor torso
    ctx.fillStyle = '#991B1B';
    ctx.strokeStyle = '#450A0A';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-r * 0.48, -r * 0.02, r * 0.96, r * 0.76, r * 0.2);
    ctx.fill();
    ctx.stroke();

    // Golden belt & tunic trim
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-r * 0.46, r * 0.42, r * 0.92, r * 0.11);

    // 5. Cartoon face under helmet
    ctx.fillStyle = '#FDBA74';
    ctx.beginPath();
    ctx.arc(0, -r * 0.22, r * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // Determined charging eyebrows & eyes
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(-r * 0.14, -r * 0.22, r * 0.068, 0, Math.PI * 2);
    ctx.arc(r * 0.14, -r * 0.22, r * 0.068, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, -r * 0.34);
    ctx.lineTo(-r * 0.05, -r * 0.28);
    ctx.moveTo(r * 0.25, -r * 0.34);
    ctx.lineTo(r * 0.05, -r * 0.28);
    ctx.stroke();

    // 6. Greek crested helmet
    ctx.save();
    ctx.translate(0, -r * 0.42);
    this.drawGreekHelmet(ctx, r * 0.74);
    ctx.restore();

    // 7. Round bronze hoplite shield in foreground left
    ctx.save();
    ctx.translate(-r * 0.46, r * 0.3 + Math.cos(runPhase) * r * 0.05);
    const shGrad = ctx.createRadialGradient(-r * 0.1, -r * 0.1, r * 0.05, 0, 0, r * 0.44);
    shGrad.addColorStop(0, '#FDE047');
    shGrad.addColorStop(0.7, '#B45309');
    shGrad.addColorStop(1, '#78350F');
    ctx.fillStyle = shGrad;
    ctx.strokeStyle = '#FEF9C3';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.43, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Greek Lambda symbol on shield
    ctx.strokeStyle = '#7F1D1D';
    ctx.lineWidth = Math.max(2.2, r * 0.085);
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, r * 0.14);
    ctx.lineTo(0, -r * 0.16);
    ctx.lineTo(r * 0.16, r * 0.14);
    ctx.stroke();
    ctx.restore();
  }

  private drawFivePointStar(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}
