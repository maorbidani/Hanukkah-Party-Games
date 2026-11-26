import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface FlyingItem {
  id: number;
  side: PlayerSide;
  kind: 'donut' | 'bomb';
  x: number; // 0..1 normalized across full canvas
  y: number; // 0..1 normalized across full canvas
  vx: number;
  vy: number;
  radius: number; // normalized to canvas width
  rotation: number;
  rotSpeed: number;
  jellyColor: string;
  frostingStyle: 'powder' | 'chocolate' | 'pink';
  graceFrames: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
}

const JELLY_COLORS = ['#E11D48', '#EC4899', '#F59E0B', '#9333EA'];
const FROSTING_STYLES: Array<'powder' | 'chocolate' | 'pink'> = ['powder', 'powder', 'chocolate', 'pink'];

export class SufganiyotGame {
  private items: FlyingItem[] = [];
  private particles: Particle[] = [];
  private popups: FloatingText[] = [];
  private nextId = 1;
  private spawnTimer = 0;

  public reset(): void {
    this.items = [];
    this.particles = [];
    this.popups = [];
    this.nextId = 1;
    this.spawnTimer = 0.25;
  }

  private spawnPair(): void {
    const isBomb = Math.random() < 0.24;
    const jellyColor = JELLY_COLORS[Math.floor(Math.random() * JELLY_COLORS.length)];
    const frostingStyle = FROSTING_STYLES[Math.floor(Math.random() * FROSTING_STYLES.length)];

    // Balanced symmetric offset so both players get equally fair spawns
    const localOffset = 0.08 + Math.random() * 0.34; // 0.08..0.42 inside half
    const upwardSpeed = -(0.72 + Math.random() * 0.24);
    const horizontalDrift = (localOffset < 0.25 ? 1 : -1) * (0.04 + Math.random() * 0.08);

    const sides: PlayerSide[] = ['left', 'right'];
    for (const side of sides) {
      const startX = side === 'left' ? localOffset : 1 - localOffset;
      const vx = side === 'left' ? horizontalDrift : -horizontalDrift;

      this.items.push({
        id: this.nextId++,
        side,
        kind: isBomb ? 'bomb' : 'donut',
        x: startX,
        y: 1.06,
        vx,
        vy: upwardSpeed,
        radius: isBomb ? 0.037 : 0.043,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 3.2,
        jellyColor,
        frostingStyle,
        graceFrames: 12,
      });
    }
  }

  private spawnExplosion(xPx: number, yPx: number, kind: 'donut' | 'bomb', jellyColor: string): void {
    if (kind === 'donut') {
      // Powdered sugar puff + jelly bursts
      for (let i = 0; i < 26; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 70 + Math.random() * 240;
        const isJelly = i < 8;
        this.particles.push({
          x: xPx,
          y: yPx,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          size: isJelly ? 4 + Math.random() * 5 : 3 + Math.random() * 6,
          color: isJelly ? jellyColor : '#FFFDF7',
          alpha: 1,
          decay: 1.4 + Math.random() * 0.8,
        });
      }
      this.popups.push({
        x: xPx,
        y: yPx - 14,
        text: '+1',
        color: '#4ADE80',
        alpha: 1,
        vy: -75,
      });
    } else {
      // Bomb smoke & sparks
      for (let i = 0; i < 24; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 260;
        this.particles.push({
          x: xPx,
          y: yPx,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 5 + Math.random() * 8,
          color: i % 3 === 0 ? '#F97316' : i % 3 === 1 ? '#EF4444' : '#334155',
          alpha: 1,
          decay: 1.6 + Math.random() * 0.6,
        });
      }
      this.popups.push({
        x: xPx,
        y: yPx - 14,
        text: '-1',
        color: '#FB7185',
        alpha: 1,
        vy: -65,
      });
    }
  }

  public update(
    dt: number,
    width: number,
    height: number,
    motion: MotionDetector,
    scores: PlayerScores
  ): boolean {
    let scoreChanged = false;
    const gravity = 0.82;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnPair();
      this.spawnTimer = 1.05 + Math.random() * 0.55;
    }

    const aspect = width / Math.max(1, height);
    const remainingItems: FlyingItem[] = [];

    for (const item of this.items) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.vy += gravity * dt;
      item.rotation += item.rotSpeed * dt;
      if (item.graceFrames > 0) item.graceFrames--;

      // Keep inside player's half horizontally
      const minX = item.side === 'left' ? 0.05 : 0.55;
      const maxX = item.side === 'left' ? 0.45 : 0.95;
      if (item.x < minX) {
        item.x = minX;
        item.vx = Math.abs(item.vx);
      } else if (item.x > maxX) {
        item.x = maxX;
        item.vx = -Math.abs(item.vx);
      }

      // Remove if fallen off bottom after rising
      if (item.y > 1.15 && item.vy > 0) {
        continue;
      }

      // Check hand motion collision once inside visible play zone (3x wide hitbox for donuts!)
      let hit = false;
      if (item.graceFrames <= 0 && item.y > 0.14 && item.y < 0.96) {
        const hitboxScale = item.kind === 'donut' ? 3.0 : 1.35;
        const radiusX = item.radius * hitboxScale;
        const radiusY = item.radius * aspect * hitboxScale;
        const motionEnergy = motion.getRegionMotion(item.x, item.y, radiusX, radiusY);

        if (motionEnergy > 0.08) {
          hit = true;
          const xPx = item.x * width;
          const yPx = item.y * height;

          if (item.kind === 'donut') {
            scores[item.side] += 1;
            soundEngine.playBite();
          } else {
            scores[item.side] = Math.max(0, scores[item.side] - 1);
            soundEngine.playBomb();
          }
          scoreChanged = true;
          this.spawnExplosion(xPx, yPx, item.kind, item.jellyColor);
        }
      }

      if (!hit) {
        remainingItems.push(item);
      }
    }

    this.items = remainingItems;

    // Update particles
    const activeParticles: Particle[] = [];
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha > 0.02) activeParticles.push(p);
    }
    this.particles = activeParticles;

    // Update floating score texts
    const activePopups: FloatingText[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.25 * dt;
      if (pop.alpha > 0.02) activePopups.push(pop);
    }
    this.popups = activePopups;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // Draw flying donuts & bombs
    for (const item of this.items) {
      const cx = item.x * width;
      const cy = item.y * height;
      const r = Math.max(18, item.radius * width);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(item.rotation);

      if (item.kind === 'donut') {
        this.drawSufganiyah(ctx, r, item.jellyColor, item.frostingStyle);
      } else {
        this.drawBomb(ctx, r);
      }

      ctx.restore();
    }

    // Draw particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw floating +1 / -1 popups
    for (const pop of this.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.alpha);
      ctx.font = '800 36px Fredoka, Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.85)';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }

  private drawSufganiyah(
    ctx: CanvasRenderingContext2D,
    r: number,
    jellyColor: string,
    frostingStyle: 'powder' | 'chocolate' | 'pink'
  ): void {
    // Soft shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.16, r * 1.02, r * 0.84, 0, 0, Math.PI * 2);
    ctx.fill();

    // Golden fried dough body
    const doughGrad = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
    doughGrad.addColorStop(0, '#FCD34D');
    doughGrad.addColorStop(0.65, '#D97706');
    doughGrad.addColorStop(1, '#92400E');
    ctx.fillStyle = doughGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.84, 0, 0, Math.PI * 2);
    ctx.fill();

    // Classic light fried ring around middle
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.5)';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.04, r * 0.92, r * 0.68, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Top glaze or powdered sugar dusting
    if (frostingStyle === 'chocolate') {
      ctx.fillStyle = '#451A03';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.12, r * 0.82, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (frostingStyle === 'pink') {
      ctx.fillStyle = '#F472B6';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.12, r * 0.82, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255, 253, 247, 0.85)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.14, r * 0.72, r * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center strawberry jelly dot
    ctx.fillStyle = jellyColor;
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.24, 0, Math.PI * 2);
    ctx.fill();

    // Glossy jelly highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(-r * 0.07, -r * 0.22, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBomb(ctx: CanvasRenderingContext2D, r: number): void {
    // Fuse stem
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.quadraticCurveTo(r * 0.35, -r * 1.15, r * 0.55, -r * 0.95);
    ctx.stroke();

    // Sizzling spark at fuse tip
    const pulse = 0.85 + Math.sin(performance.now() * 0.03) * 0.25;
    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.arc(r * 0.58, -r * 0.95, r * 0.22 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(r * 0.58, -r * 0.95, r * 0.11 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Dark bomb sphere
    const bombGrad = ctx.createRadialGradient(-r * 0.28, -r * 0.28, r * 0.1, 0, 0, r);
    bombGrad.addColorStop(0, '#475569');
    bombGrad.addColorStop(0.55, '#1E293B');
    bombGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bombGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Warning stripe / X mark
    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, -r * 0.28);
    ctx.lineTo(r * 0.28, r * 0.28);
    ctx.moveTo(r * 0.28, -r * 0.28);
    ctx.lineTo(-r * 0.28, r * 0.28);
    ctx.stroke();
  }
}
