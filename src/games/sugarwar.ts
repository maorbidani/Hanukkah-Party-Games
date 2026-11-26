import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface SugarBall {
  id: number;
  ownerSide: PlayerSide;
  state: 'waiting' | 'flying';
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  radius: number;
  bobPhase: number;
}

interface SugarSplat {
  side: PlayerSide; // Which player's half is covered
  x: number;
  y: number;
  radius: number;
  timeLeft: number; // 3.0 seconds
  lobes: Array<{ dx: number; dy: number; rScale: number }>;
}

interface PowderParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  alpha: number;
  vy: number;
}

export class SugarWarGame {
  private balls: SugarBall[] = [];
  private splats: SugarSplat[] = [];
  private particles: PowderParticle[] = [];
  private popups: FloatingText[] = [];
  private nextId = 1;
  private spawnCooldown: Record<PlayerSide, number> = { left: 0, right: 0 };

  public reset(): void {
    this.balls = [];
    this.splats = [];
    this.particles = [];
    this.popups = [];
    this.nextId = 1;
    this.spawnCooldown = { left: 0.2, right: 0.2 };
  }

  private spawnBall(side: PlayerSide): void {
    const x = side === 'left' ? 0.1 + Math.random() * 0.32 : 0.58 + Math.random() * 0.32;
    const y = 0.24 + Math.random() * 0.58;
    this.balls.push({
      id: this.nextId++,
      ownerSide: side,
      state: 'waiting',
      x,
      y,
      vx: 0,
      vy: 0,
      targetX: x,
      targetY: y,
      radius: 0.036,
      bobPhase: Math.random() * Math.PI * 2,
    });
  }

  private createSplat(targetSide: PlayerSide, x: number, y: number): void {
    const lobes = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 0.35 + Math.random() * 0.55;
      return {
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist,
        rScale: 0.45 + Math.random() * 0.4,
      };
    });

    this.splats.push({
      side: targetSide,
      x,
      y,
      radius: 0.145, // Large white powdered sugar blot covering part of opponent's screen
      timeLeft: 3.0,
      lobes,
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

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const waitingCount = this.balls.filter(
        (b) => b.ownerSide === side && b.state === 'waiting'
      ).length;
      if (waitingCount < 3) {
        this.spawnCooldown[side] -= dt;
        if (this.spawnCooldown[side] <= 0) {
          this.spawnBall(side);
          this.spawnCooldown[side] = 0.55;
        }
      }
    });

    const remainingBalls: SugarBall[] = [];

    for (const ball of this.balls) {
      if (ball.state === 'waiting') {
        ball.bobPhase += dt * 3.2;
        const drawY = ball.y + Math.sin(ball.bobPhase) * 0.012;

        // 3x wide hitbox around each glowing sugar ball
        const rx = ball.radius * 3.0;
        const ry = ball.radius * aspect * 3.0;
        const hit = motion.getRegionMotion(ball.x, drawY, rx, ry) > 0.08;

        if (hit) {
          ball.state = 'flying';
          const opponentSide: PlayerSide = ball.ownerSide === 'left' ? 'right' : 'left';
          ball.targetX =
            opponentSide === 'left'
              ? 0.08 + Math.random() * 0.34
              : 0.58 + Math.random() * 0.34;
          ball.targetY = 0.22 + Math.random() * 0.58;

          const dx = ball.targetX - ball.x;
          const dy = ball.targetY - ball.y;
          const dist = Math.max(0.1, Math.hypot(dx, dy));
          const speed = 1.45;
          ball.vx = (dx / dist) * speed;
          ball.vy = (dy / dist) * speed;

          scores[ball.ownerSide] += 1;
          scoreChanged = true;
          soundEngine.playSugarThrow();

          this.popups.push({
            x: ball.x * width,
            y: drawY * height - 20,
            text: '+1',
            alpha: 1,
            vy: -75,
          });
        }
        remainingBalls.push(ball);
      } else {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Leave white powder comet particles while flying
        this.particles.push({
          x: ball.x * width + (Math.random() - 0.5) * 14,
          y: ball.y * height + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 40,
          vy: (Math.random() - 0.5) * 40,
          size: 4 + Math.random() * 5,
          alpha: 0.9,
        });

        const distToTarget = Math.hypot(ball.targetX - ball.x, ball.targetY - ball.y);
        const crossed =
          (ball.ownerSide === 'left' && ball.x >= ball.targetX) ||
          (ball.ownerSide === 'right' && ball.x <= ball.targetX);

        if (distToTarget < 0.05 || crossed) {
          const opponentSide: PlayerSide = ball.ownerSide === 'left' ? 'right' : 'left';
          this.createSplat(opponentSide, ball.targetX, ball.targetY);
          soundEngine.playSugarSplat();

          for (let i = 0; i < 20; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 80 + Math.random() * 200;
            this.particles.push({
              x: ball.targetX * width,
              y: ball.targetY * height,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              size: 5 + Math.random() * 7,
              alpha: 1,
            });
          }
        } else {
          remainingBalls.push(ball);
        }
      }
    }

    this.balls = remainingBalls;

    // Update 3-second powdered sugar splats
    const activeSplats: SugarSplat[] = [];
    for (const sp of this.splats) {
      sp.timeLeft -= dt;
      if (sp.timeLeft > 0) activeSplats.push(sp);
    }
    this.splats = activeSplats;

    // Update powder particles
    const activeParticles: PowderParticle[] = [];
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= 1.8 * dt;
      if (p.alpha > 0.02) activeParticles.push(p);
    }
    this.particles = activeParticles;

    // Update +1 popups
    const activePopups: FloatingText[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.3 * dt;
      if (pop.alpha > 0.02) activePopups.push(pop);
    }
    this.popups = activePopups;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const now = performance.now();

    // Draw waiting & flying glowing sugar balls
    for (const ball of this.balls) {
      const cx = ball.x * width;
      const cy =
        (ball.state === 'waiting'
          ? ball.y + Math.sin(ball.bobPhase) * 0.012
          : ball.y) * height;
      const r = Math.max(17, ball.radius * width);

      ctx.save();
      const pulse = 1 + Math.sin(now * 0.01 + ball.id) * 0.1;
      const aura = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.8 * pulse);
      aura.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      aura.addColorStop(
        0.5,
        ball.ownerSide === 'left'
          ? 'rgba(125, 211, 252, 0.55)'
          : 'rgba(253, 224, 71, 0.55)'
      );
      aura.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.8 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Fluffy powdered sugar sphere
      const core = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 2, cx, cy, r);
      core.addColorStop(0, '#FFFFFF');
      core.addColorStop(0.75, '#F1F5F9');
      core.addColorStop(1, '#CBD5E1');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = ball.ownerSide === 'left' ? '#38BDF8' : '#FACC15';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Draw flying powder particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw large white powdered-sugar splats covering opponent's side (3s duration)
    for (const sp of this.splats) {
      const alpha = sp.timeLeft < 0.6 ? sp.timeLeft / 0.6 : 0.94;
      const cx = sp.x * width;
      const cy = sp.y * height;
      const r = sp.radius * width;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#FFFDF9';
      ctx.shadowColor = 'rgba(226, 232, 240, 0.85)';
      ctx.shadowBlur = 18;

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.fill();

      for (const lobe of sp.lobes) {
        ctx.beginPath();
        ctx.arc(cx + lobe.dx * r, cy + lobe.dy * r, r * lobe.rScale, 0, Math.PI * 2);
        ctx.fill();
      }
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
}
