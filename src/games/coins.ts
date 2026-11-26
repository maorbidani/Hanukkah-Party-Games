import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface FallingTreasure {
  id: number;
  side: PlayerSide;
  kind: 'coin' | 'bag' | 'coal';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotSpeed: number;
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
  color: string;
  alpha: number;
  vy: number;
}

export class CoinsGame {
  private items: FallingTreasure[] = [];
  private sparks: Spark[] = [];
  private popups: FloatingText[] = [];
  private nextId = 1;
  private spawnTimer = 0.25;

  public reset(): void {
    this.items = [];
    this.sparks = [];
    this.popups = [];
    this.nextId = 1;
    this.spawnTimer = 0.25;
  }

  private spawnPair(): void {
    const roll = Math.random();
    const kind: FallingTreasure['kind'] =
      roll < 0.14 ? 'bag' : roll < 0.34 ? 'coal' : 'coin';

    const localOffset = 0.08 + Math.random() * 0.34;
    const fallSpeed = kind === 'bag' ? 0.34 + Math.random() * 0.1 : 0.26 + Math.random() * 0.14;
    const drift = (Math.random() - 0.5) * 0.05;

    const sides: PlayerSide[] = ['left', 'right'];
    for (const side of sides) {
      const startX = side === 'left' ? localOffset : 1 - localOffset;
      const vx = side === 'left' ? drift : -drift;
      this.items.push({
        id: this.nextId++,
        side,
        kind,
        x: startX,
        y: -0.06,
        vx,
        vy: fallSpeed,
        radius: kind === 'bag' ? 0.038 : kind === 'coin' ? 0.032 : 0.031,
        rotation: Math.random() * 0.4 - 0.2,
        rotSpeed: (Math.random() - 0.5) * 2.4,
      });
    }
  }

  private spawnCollectBurst(xPx: number, yPx: number, kind: FallingTreasure['kind']): void {
    const count = kind === 'bag' ? 30 : 18;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 220;
      this.sparks.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        size: kind === 'bag' ? 4 + Math.random() * 5 : 3 + Math.random() * 4,
        color:
          kind === 'coal'
            ? i % 2 === 0
              ? '#475569'
              : '#EF4444'
            : i % 3 === 0
            ? '#FFFFFF'
            : '#FACC15',
        alpha: 1,
      });
    }

    const text = kind === 'bag' ? '+5' : kind === 'coin' ? '+1' : '-2';
    const color = kind === 'bag' ? '#FDE047' : kind === 'coin' ? '#4ADE80' : '#FB7185';
    this.popups.push({
      x: xPx,
      y: yPx - 16,
      text,
      color,
      alpha: 1,
      vy: -78,
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

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnPair();
      this.spawnTimer = 0.68 + Math.random() * 0.42;
    }

    const remaining: FallingTreasure[] = [];

    for (const item of this.items) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.rotation += item.rotSpeed * dt;

      const minX = item.side === 'left' ? 0.05 : 0.55;
      const maxX = item.side === 'left' ? 0.45 : 0.95;
      if (item.x < minX) {
        item.x = minX;
        item.vx = Math.abs(item.vx);
      } else if (item.x > maxX) {
        item.x = maxX;
        item.vx = -Math.abs(item.vx);
      }

      if (item.y > 1.1) {
        continue;
      }

      let collected = false;
      if (item.y > 0.12 && item.y < 0.96) {
        // 3x wide hitbox for coins & gold bags, fair 1.35x for black coals
        const hitboxScale = item.kind === 'coal' ? 1.35 : 3.0;
        const rx = item.radius * hitboxScale;
        const ry = item.radius * aspect * hitboxScale;
        const energy = motion.getRegionMotion(item.x, item.y, rx, ry);

        if (energy > 0.08) {
          collected = true;
          scoreChanged = true;
          if (item.kind === 'coin') {
            scores[item.side] += 1;
            soundEngine.playCoinCollect();
          } else if (item.kind === 'bag') {
            scores[item.side] += 5;
            soundEngine.playJackpotBag();
          } else {
            scores[item.side] = Math.max(0, scores[item.side] - 2);
            soundEngine.playBomb();
          }
          this.spawnCollectBurst(item.x * width, item.y * height, item.kind);
        }
      }

      if (!collected) {
        remaining.push(item);
      }
    }

    this.items = remaining;

    const activeSparks: Spark[] = [];
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 260 * dt;
      s.alpha -= 1.6 * dt;
      if (s.alpha > 0.02) activeSparks.push(s);
    }
    this.sparks = activeSparks;

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

    for (const item of this.items) {
      const cx = item.x * width;
      const cy = item.y * height;
      const r = Math.max(16, item.radius * width);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(item.rotation);

      if (item.kind === 'coin') {
        this.drawChocolateCoin(ctx, r);
      } else if (item.kind === 'bag') {
        this.drawGoldBag(ctx, r, now);
      } else {
        this.drawCoal(ctx, r);
      }

      ctx.restore();
    }

    for (const s of this.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const pop of this.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop.alpha);
      ctx.font = '800 38px Fredoka, Rubik, sans-serif';
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

  private drawChocolateCoin(ctx: CanvasRenderingContext2D, r: number): void {
    // Foil glow
    ctx.fillStyle = 'rgba(250, 204, 21, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
    ctx.fill();

    // Gold foil coin body
    const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#FEF08A');
    grad.addColorStop(0.55, '#FACC15');
    grad.addColorStop(1, '#B45309');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#FEF9C3';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();

    // Embossed ₪ / star emblem
    ctx.fillStyle = '#92400E';
    ctx.font = `800 ${Math.round(r * 0.85)}px Fredoka, Rubik, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✡', 0, 2);
  }

  private drawGoldBag(ctx: CanvasRenderingContext2D, r: number, now: number): void {
    const pulse = 1 + Math.sin(now * 0.012) * 0.12;

    // Sparkling aura
    const aura = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.75 * pulse);
    aura.addColorStop(0, 'rgba(254, 240, 138, 0.7)');
    aura.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.75 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Pouch body
    const bagGrad = ctx.createRadialGradient(-r * 0.2, 0, r * 0.1, 0, r * 0.1, r * 1.05);
    bagGrad.addColorStop(0, '#FDE047');
    bagGrad.addColorStop(0.6, '#D97706');
    bagGrad.addColorStop(1, '#92400E');
    ctx.fillStyle = bagGrad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, -r * 0.45);
    ctx.quadraticCurveTo(-r * 1.05, r * 0.35, 0, r * 0.95);
    ctx.quadraticCurveTo(r * 1.05, r * 0.35, r * 0.45, -r * 0.45);
    ctx.closePath();
    ctx.fill();

    // Frilled pouch top
    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.85);
    ctx.lineTo(r * 0.55, -r * 0.85);
    ctx.lineTo(r * 0.32, -r * 0.42);
    ctx.lineTo(-r * 0.32, -r * 0.42);
    ctx.closePath();
    ctx.fill();

    // Ribbon tie
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-r * 0.4, -r * 0.5, r * 0.8, r * 0.16);

    // "+5" label on bag
    ctx.fillStyle = '#78350F';
    ctx.font = `900 ${Math.round(r * 0.72)}px Fredoka, Rubik, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+5', 0, r * 0.22);
  }

  private drawCoal(ctx: CanvasRenderingContext2D, r: number): void {
    // Jagged dark coal lump
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rad = r * (i % 2 === 0 ? 0.95 : 0.74);
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Red warning ember / X
    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, -r * 0.28);
    ctx.lineTo(r * 0.28, r * 0.28);
    ctx.moveTo(r * 0.28, -r * 0.28);
    ctx.lineTo(-r * 0.28, r * 0.28);
    ctx.stroke();
  }
}
