import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface LightningBolt {
  attacker: PlayerSide;
  target: PlayerSide;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number; // 0..1
  speed: number;
  seed: number;
  radiusPx: number;
}

interface ImpactSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

interface ElectricFlashArc {
  x: number;
  y: number;
  angle: number;
  length: number;
  color: string;
  alpha: number;
}

interface FloatingDamage {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
}

export class DuelGame {
  private bolts: LightningBolt[] = [];
  private sparks: ImpactSpark[] = [];
  private arcs: ElectricFlashArc[] = [];
  private popups: FloatingDamage[] = [];

  private charge: Record<PlayerSide, number> = { left: 0, right: 0 };
  private fireCooldown: Record<PlayerSide, number> = { left: 0, right: 0 };
  private powerSmoothed: Record<PlayerSide, number> = { left: 0, right: 0 };
  private shakeTimer: Record<PlayerSide, number> = { left: 0, right: 0 };
  private hitFlash: Record<PlayerSide, number> = { left: 0, right: 0 };
  private lastShootSfxMs: Record<PlayerSide, number> = { left: 0, right: 0 };
  private koTriggered = false;

  public reset(): void {
    this.bolts = [];
    this.sparks = [];
    this.arcs = [];
    this.popups = [];
    this.charge = { left: 0, right: 0 };
    this.fireCooldown = { left: 0, right: 0 };
    this.powerSmoothed = { left: 0, right: 0 };
    this.shakeTimer = { left: 0, right: 0 };
    this.hitFlash = { left: 0, right: 0 };
    this.lastShootSfxMs = { left: 0, right: 0 };
    this.koTriggered = false;
  }

  public isKnockout(): boolean {
    return this.koTriggered;
  }

  private launchLightningBolt(attacker: PlayerSide, motion: MotionDetector): void {
    const target: PlayerSide = attacker === 'left' ? 'right' : 'left';
    const handPos = motion.getPrimaryHandPos(attacker);

    const startX = handPos ? handPos.normX : attacker === 'left' ? 0.25 : 0.75;
    const startY = handPos ? Math.max(0.24, Math.min(0.84, handPos.normY)) : 0.42 + Math.random() * 0.3;
    const targetX = target === 'left' ? 0.14 + Math.random() * 0.22 : 0.64 + Math.random() * 0.22;
    const targetY = 0.28 + Math.random() * 0.46;

    this.bolts.push({
      attacker,
      target,
      x: startX,
      y: startY,
      startX,
      startY,
      targetX,
      targetY,
      progress: 0,
      speed: 2.65 + Math.random() * 0.45, // snappy flight across center divider
      seed: Math.random() * 1000,
      radiusPx: 20,
    });

    const nowMs = performance.now();
    if (nowMs - this.lastShootSfxMs[attacker] > 140) {
      this.lastShootSfxMs[attacker] = nowMs;
      soundEngine.playLightningShoot(attacker);
    }
  }

  private spawnImpactBurst(xPx: number, yPx: number, attacker: PlayerSide): void {
    const primary = attacker === 'left' ? '#38BDF8' : '#FB923C';
    const accent = '#FEF08A';

    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const speed = 150 + Math.random() * 280;
      this.sparks.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: 3 + Math.random() * 5,
        color: i % 3 === 0 ? '#FFFFFF' : i % 2 === 0 ? accent : primary,
        alpha: 1,
      });
    }

    for (let i = 0; i < 6; i++) {
      this.arcs.push({
        x: xPx,
        y: yPx,
        angle: (i / 6) * Math.PI * 2 + Math.random() * 0.4,
        length: 45 + Math.random() * 55,
        color: i % 2 === 0 ? '#FFFFFF' : primary,
        alpha: 1,
      });
    }

    this.popups.push({
      x: xPx,
      y: yPx - 24,
      text: '-4%',
      color: '#FB7185',
      alpha: 1,
      vy: -85,
    });
  }

  public update(
    dt: number,
    width: number,
    height: number,
    motion: MotionDetector,
    scores: PlayerScores
  ): boolean {
    let hpChanged = false;

    // 1. Decay hit shake & flash timers
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      this.shakeTimer[side] = Math.max(0, this.shakeTimer[side] - dt);
      this.hitFlash[side] = Math.max(0, this.hitFlash[side] - dt * 3.2);
      this.fireCooldown[side] = Math.max(0, this.fireCooldown[side] - dt);
    });

    // 2. Measure hand waving speed on each half -> charge and fire lightning bolts
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      if (this.koTriggered) return;

      const rawSpeed = motion.getHalfSpeedScore(side);
      // Smooth power indicator for clean visual energy aura
      this.powerSmoothed[side] += (rawSpeed - this.powerSmoothed[side]) * Math.min(1, dt * 14);

      if (rawSpeed > 0.08) {
        // Faster waving charges lightning bolts proportionally faster
        const chargeRate = 1.45 + rawSpeed * 4.5;
        this.charge[side] += chargeRate * dt;
      } else {
        this.charge[side] = Math.max(0, this.charge[side] - dt * 1.0);
      }

      if (this.charge[side] >= 1.0 && this.fireCooldown[side] <= 0) {
        this.charge[side] -= 1.0;
        this.fireCooldown[side] = 0.13;
        this.launchLightningBolt(side, motion);
      }
    });

    // 3. Advance flying lightning orbs across the center divider & apply -4% damage on impact
    const activeBolts: LightningBolt[] = [];
    for (const bolt of this.bolts) {
      bolt.progress += bolt.speed * dt;
      // Slight electric curve in flight
      const arcLift = Math.sin(bolt.progress * Math.PI) * 0.08;
      bolt.x = bolt.startX + (bolt.targetX - bolt.startX) * bolt.progress;
      bolt.y = bolt.startY + (bolt.targetY - bolt.startY) * bolt.progress - arcLift;

      if (bolt.progress >= 1.0) {
        if (!this.koTriggered) {
          scores[bolt.target] = Math.max(0, scores[bolt.target] - 4);
          hpChanged = true;
          this.shakeTimer[bolt.target] = 0.28;
          this.hitFlash[bolt.target] = 1.0;
          soundEngine.playLightningHit();
          this.spawnImpactBurst(bolt.targetX * width, bolt.targetY * height, bolt.attacker);

          if (scores[bolt.target] <= 0) {
            this.koTriggered = true;
          }
        }
        continue;
      }

      activeBolts.push(bolt);
    }
    this.bolts = activeBolts;

    // 4. Update impact sparks, jagged shock arcs & floating -4% popups
    const activeSparks: ImpactSpark[] = [];
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.94;
      s.vy *= 0.94;
      s.alpha -= 2.3 * dt;
      if (s.alpha > 0.03) activeSparks.push(s);
    }
    this.sparks = activeSparks;

    const activeArcs: ElectricFlashArc[] = [];
    for (const a of this.arcs) {
      a.alpha -= 3.2 * dt;
      if (a.alpha > 0.03) activeArcs.push(a);
    }
    this.arcs = activeArcs;

    const activePopups: FloatingDamage[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.55 * dt;
      if (pop.alpha > 0.03) activePopups.push(pop);
    }
    this.popups = activePopups;

    return hpChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const now = performance.now();
    const halfW = width / 2;

    // 1. Per-side Hit Shake overlay, Energy Charge Aura & Hit Flash
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const isLeft = side === 'left';
      const xStart = isLeft ? 0 : halfW;
      const shakeAmt = this.shakeTimer[side] > 0 ? Math.sin(now * 0.09) * 11 * (this.shakeTimer[side] / 0.28) : 0;
      const shakeY = this.shakeTimer[side] > 0 ? Math.cos(now * 0.11) * 7 * (this.shakeTimer[side] / 0.28) : 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(xStart, 0, halfW, height);
      ctx.clip();

      // Red impact flash border when struck
      if (this.hitFlash[side] > 0.02) {
        const flashGrad = ctx.createRadialGradient(
          xStart + halfW / 2 + shakeAmt,
          height * 0.5 + shakeY,
          halfW * 0.15,
          xStart + halfW / 2,
          height * 0.5,
          halfW * 0.85
        );
        flashGrad.addColorStop(0, 'rgba(244, 63, 94, 0)');
        flashGrad.addColorStop(1, `rgba(225, 29, 72, ${this.hitFlash[side] * 0.45})`);
        ctx.fillStyle = flashGrad;
        ctx.fillRect(xStart, 0, halfW, height);
      }

      // Bottom translucent electric power aura (keeps webcam <video> behind canvas clear)
      const power = Math.min(1, this.powerSmoothed[side]);
      const auraColor = isLeft ? '56, 189, 248' : '251, 146, 60';
      const centerX = xStart + halfW / 2 + shakeAmt;
      const baseGlow = ctx.createRadialGradient(
        centerX,
        height * 0.9,
        10,
        centerX,
        height * 0.9,
        halfW * (0.35 + power * 0.4)
      );
      baseGlow.addColorStop(0, `rgba(${auraColor}, ${0.08 + power * 0.3})`);
      baseGlow.addColorStop(1, `rgba(${auraColor}, 0)`);
      ctx.fillStyle = baseGlow;
      ctx.fillRect(xStart, height * 0.45, halfW, height * 0.55);

      // Visual Charge Bar right near bottom center of each half
      const barW = Math.min(200, halfW * 0.55);
      const barH = 12;
      const bx = centerX - barW / 2;
      const by = height - 42 + shakeY;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = `rgba(${auraColor}, 0.7)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, barH, 6);
      ctx.fill();
      ctx.stroke();

      const fillRatio = Math.max(0.04, Math.min(1, this.charge[side]));
      ctx.fillStyle = isLeft ? '#38BDF8' : '#FACC15';
      ctx.beginPath();
      ctx.roundRect(bx + 2, by + 2, (barW - 4) * fillRatio, barH - 4, 4);
      ctx.fill();

      const labelFontSize = Math.max(11, Math.min(14, Math.round(halfW * 0.075)));
      ctx.font = `700 ${labelFontSize}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText('נופפו ידיים מהר לטעינת ברק! ⚡', centerX, by - 10, halfW * 0.9);

      ctx.restore();
    });

    // 2. Draw flying crackling energy orbs & jagged lightning tails crossing the center divider
    for (const bolt of this.bolts) {
      const bx = bolt.x * width;
      const by = bolt.y * height;
      const isLeftAttacker = bolt.attacker === 'left';
      const mainColor = isLeftAttacker ? '#38BDF8' : '#FB923C';
      const coreColor = '#FEF9C3';

      // Direction vector backward for trailing lightning bolt tail
      const dx = (bolt.targetX - bolt.startX) * width;
      const dy = (bolt.targetY - bolt.startY) * height;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / dist;
      const uy = dy / dist;
      const px = -uy;
      const py = ux;

      // Crackling jagged lightning tail
      ctx.save();
      ctx.shadowColor = mainColor;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      const tailSegments = 5;
      for (let s = 1; s <= tailSegments; s++) {
        const backDist = s * 19;
        const jitter = Math.sin(now * 0.045 + bolt.seed + s * 2.1) * 14;
        ctx.lineTo(bx - ux * backDist + px * jitter, by - uy * backDist + py * jitter);
      }
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Glowing Lightning Energy Orb head
      const orbAura = ctx.createRadialGradient(bx, by, 3, bx, by, bolt.radiusPx * 1.9);
      orbAura.addColorStop(0, '#FFFFFF');
      orbAura.addColorStop(0.35, coreColor);
      orbAura.addColorStop(0.7, mainColor);
      orbAura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = orbAura;
      ctx.beginPath();
      ctx.arc(bx, by, bolt.radiusPx * 1.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(bx, by, bolt.radiusPx * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Draw jagged electric impact arcs
    for (const arc of this.arcs) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, arc.alpha);
      ctx.translate(arc.x, arc.y);
      ctx.rotate(arc.angle);
      ctx.strokeStyle = arc.color;
      ctx.shadowColor = arc.color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(arc.length * 0.35, -9);
      ctx.lineTo(arc.length * 0.68, 8);
      ctx.lineTo(arc.length, -3);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Draw electric impact sparks
    for (const s of this.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Draw -4% floating damage popups
    for (const pop of this.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.alpha);
      ctx.font = '800 36px Fredoka, Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.9)';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }
}
