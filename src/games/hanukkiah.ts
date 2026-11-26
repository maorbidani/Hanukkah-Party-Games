import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface CandleState {
  lit: boolean;
  litTime: number;
}

interface HanukkiahBoard {
  candles: CandleState[]; // 8 candles
  shamashGrabbed: boolean;
  heldPos: { nx: number; ny: number } | null;
  completedAt: number | null;
  themeIndex: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  size: number;
}

const HANUKKIAH_THEMES = [
  { metal: '#F59E0B', highlight: '#FEF08A', dark: '#B45309', candleBody: '#EFF6FF', stripe: '#3B82F6' },
  { metal: '#CBD5E1', highlight: '#F8FAFC', dark: '#64748B', candleBody: '#FEF3C7', stripe: '#D97706' },
  { metal: '#38BDF8', highlight: '#BAE6FD', dark: '#0369A1', candleBody: '#FDF2F8', stripe: '#EC4899' },
];

export class HanukkiahGame {
  private boards: Record<PlayerSide, HanukkiahBoard> = {
    left: this.createFreshBoard(0),
    right: this.createFreshBoard(0),
  };
  private sparks: Spark[] = [];

  private createFreshBoard(themeIndex: number): HanukkiahBoard {
    return {
      candles: Array.from({ length: 8 }, () => ({ lit: false, litTime: 0 })),
      shamashGrabbed: false,
      heldPos: null,
      completedAt: null,
      themeIndex,
    };
  }

  public reset(): void {
    this.boards = {
      left: this.createFreshBoard(0),
      right: this.createFreshBoard(0),
    };
    this.sparks = [];
  }

  private getCornerShamashPos(side: PlayerSide): { nx: number; ny: number } {
    return {
      nx: side === 'left' ? 0.09 : 0.91,
      ny: 0.28,
    };
  }

  private getCandleNormPos(side: PlayerSide, candleIdx: number): { nx: number; ny: number; targetY: number } {
    const halfStart = side === 'left' ? 0.06 : 0.56;
    const halfSpan = 0.38;
    const slot = candleIdx < 4 ? candleIdx : candleIdx + 1;
    const nx = halfStart + (slot / 8) * halfSpan;
    const ny = 0.58;
    const targetY = 0.52; // General center of candle + wick zone for generous 3x hitbox
    return { nx, ny, targetY };
  }

  private spawnBurst(xPx: number, yPx: number, count: number, celebratory: boolean = false): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = celebratory ? 110 + Math.random() * 270 : 50 + Math.random() * 130;
      this.sparks.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (celebratory ? 75 : 50),
        alpha: 1,
        color: i % 2 === 0 ? '#FACC15' : celebratory ? '#38BDF8' : '#FB923C',
        size: celebratory ? 4 + Math.random() * 5.5 : 3 + Math.random() * 3.5,
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
    const now = performance.now();

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const board = this.boards[side];

      if (board.completedAt !== null) {
        if (now - board.completedAt >= 750) {
          this.boards[side] = this.createFreshBoard((board.themeIndex + 1) % HANUKKIAH_THEMES.length);
        }
        return;
      }

      // Phase 1: Grab the glowing Shamash from the upper corner
      if (!board.shamashGrabbed) {
        const shamashPos = this.getCornerShamashPos(side);
        const handPos = motion.getPrimaryHandPos(side);
        const directTouch =
          handPos !== null &&
          Math.abs(handPos.normX - shamashPos.nx) < 0.095 &&
          Math.abs(handPos.normY - shamashPos.ny) < 0.155;
        // 3x wide hitbox around the corner Shamash
        const hitShamash = motion.getRegionMotion(shamashPos.nx, shamashPos.ny, 0.092, 0.15);
        if (directTouch || hitShamash > 0.07) {
          board.shamashGrabbed = true;
          board.heldPos = handPos ? { nx: handPos.normX, ny: handPos.normY } : { ...shamashPos };
          soundEngine.playShamashGrab();
          this.spawnBurst(shamashPos.nx * width, shamashPos.ny * height, 22, false);
        }
        return;
      }

      // Phase 2: Shamash is attached to the player's palm center!
      const liveHand = motion.getPrimaryHandPos(side);
      if (liveHand) {
        board.heldPos = { nx: liveHand.normX, ny: liveHand.normY };
      }

      // Check all 8 candles with 3x wide hitbox + direct held-Shamash contact
      let litCount = 0;
      board.candles.forEach((candle, idx) => {
        if (candle.lit) {
          litCount++;
          return;
        }

        const { nx, targetY } = this.getCandleNormPos(side, idx);
        const directShamash =
          board.heldPos !== null &&
          Math.abs(board.heldPos.nx - nx) < 0.068 &&
          Math.abs(board.heldPos.ny - targetY) < 0.155;
        // 3x wider hitbox around the general candle area
        const motionEnergy = motion.getRegionMotion(nx, targetY, 0.07, 0.175);

        if (directShamash || motionEnergy > 0.07) {
          candle.lit = true;
          candle.litTime = now;
          litCount++;
          soundEngine.playCandleLight(litCount - 1);
          this.spawnBurst(nx * width, (targetY - 0.06) * height, 18, false);
        }
      });

      if (litCount === 8 && board.completedAt === null) {
        board.completedAt = now;
        scores[side] += 1;
        scoreChanged = true;
        soundEngine.playHanukkiahComplete();
        const centerX = (side === 'left' ? 0.25 : 0.75) * width;
        this.spawnBurst(centerX, height * 0.45, 42, true);
      }
    });

    // Update sparks
    const activeSparks: Spark[] = [];
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 180 * dt;
      s.alpha -= 1.45 * dt;
      if (s.alpha > 0.02) activeSparks.push(s);
    }
    this.sparks = activeSparks;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const now = performance.now();

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const board = this.boards[side];
      const theme = HANUKKIAH_THEMES[board.themeIndex];
      const centerX = (side === 'left' ? 0.25 : 0.75) * width;
      const baseBottomY = height * 0.85;
      const stemTopY = height * 0.68;

      if (board.completedAt !== null) {
        ctx.save();
        const glow = ctx.createRadialGradient(centerX, height * 0.5, 20, centerX, height * 0.5, width * 0.24);
        glow.addColorStop(0, 'rgba(250, 204, 21, 0.38)');
        glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(centerX, height * 0.5, width * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw Hanukkiah metal frame & branches
      ctx.save();
      ctx.strokeStyle = theme.metal;
      ctx.fillStyle = theme.metal;
      ctx.lineWidth = Math.max(6, width * 0.008);
      ctx.lineCap = 'round';

      // Pedestal base
      ctx.beginPath();
      ctx.moveTo(centerX - width * 0.085, baseBottomY);
      ctx.lineTo(centerX + width * 0.085, baseBottomY);
      ctx.lineTo(centerX + width * 0.045, baseBottomY - height * 0.045);
      ctx.lineTo(centerX - width * 0.045, baseBottomY - height * 0.045);
      ctx.closePath();
      ctx.fill();

      // Central vertical pillar
      ctx.beginPath();
      ctx.moveTo(centerX, baseBottomY - height * 0.04);
      ctx.lineTo(centerX, height * 0.49);
      ctx.stroke();

      // Center Shamash holder cup (waiting slot)
      const shamashCupY = height * 0.49;
      ctx.fillStyle = theme.dark;
      ctx.fillRect(centerX - width * 0.015, shamashCupY - 5, width * 0.03, 9);

      // Curved arms for each of the 8 candles
      const branchY = height * 0.58;
      for (let i = 0; i < 8; i++) {
        const { nx } = this.getCandleNormPos(side, i);
        const cx = nx * width;
        ctx.strokeStyle = theme.metal;
        ctx.lineWidth = Math.max(5, width * 0.0065);
        ctx.beginPath();
        ctx.moveTo(centerX, stemTopY);
        ctx.quadraticCurveTo(centerX + (cx - centerX) * 0.6, stemTopY + height * 0.03, cx, branchY);
        ctx.stroke();

        ctx.fillStyle = theme.dark;
        ctx.fillRect(cx - width * 0.012, branchY - 5, width * 0.024, 8);
      }

      // Draw the 8 interactive candles
      const candleW = Math.max(12, width * 0.016);
      const candleH = height * 0.085;
      for (let i = 0; i < 8; i++) {
        const candle = board.candles[i];
        const { nx } = this.getCandleNormPos(side, i);
        const cx = nx * width;
        const candleTopY = branchY - candleH;

        ctx.fillStyle = theme.candleBody;
        ctx.beginPath();
        ctx.roundRect(cx - candleW * 0.5, candleTopY, candleW, candleH, 4);
        ctx.fill();

        ctx.fillStyle = theme.stripe;
        ctx.fillRect(cx - candleW * 0.5, candleTopY + candleH * 0.35, candleW, candleH * 0.16);

        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, candleTopY);
        ctx.lineTo(cx, candleTopY - 8);
        ctx.stroke();

        if (candle.lit) {
          this.drawFlame(ctx, cx, candleTopY - 10, Math.max(10, width * 0.015), now, i);
        } else if (board.shamashGrabbed) {
          // Subtle glowing target ring showing player can light this candle
          const pulse = 0.75 + Math.sin(now * 0.006 + i) * 0.25;
          ctx.save();
          ctx.strokeStyle = `rgba(253, 224, 71, ${0.42 * pulse})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(cx, candleTopY - 6, Math.max(16, width * 0.02), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Corner Shamash (when not yet grabbed) OR Held Shamash (attached to palm center)
      if (!board.shamashGrabbed && board.completedAt === null) {
        const corner = this.getCornerShamashPos(side);
        const sx = corner.nx * width;
        const sy = corner.ny * height;
        this.drawCornerShamash(ctx, sx, sy, width, now);
      } else if (board.shamashGrabbed && board.heldPos && board.completedAt === null) {
        const hx = board.heldPos.nx * width;
        const hy = board.heldPos.ny * height;
        this.drawHeldShamash(ctx, hx, hy, width, now);
      }

      // Status prompt under Hanukkiah
      const litCount = board.candles.filter((c) => c.lit).length;
      const statusFontSize = Math.max(13, Math.min(22, Math.round(width * 0.025)));
      const maxPromptW = width * 0.44;
      ctx.font = `800 ${statusFontSize}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.85)';
      const label =
        litCount === 8
          ? 'חנוכייה דלוקה! +1'
          : !board.shamashGrabbed
          ? 'תפסו את נר השמש בפינה!'
          : `הדליקו את הנרות! (${litCount} / 8)`;
      ctx.strokeText(label, centerX, height * 0.92, maxPromptW);
      ctx.fillStyle = litCount === 8 ? '#4ADE80' : !board.shamashGrabbed ? '#FACC15' : '#FEF08A';
      ctx.fillText(label, centerX, height * 0.92, maxPromptW);

      ctx.restore();
    });

    // Draw sparks
    for (const s of this.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCornerShamash(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    viewW: number,
    now: number
  ): void {
    const pulse = 1 + Math.sin(now * 0.008) * 0.1;
    const candleW = Math.max(22, viewW * 0.022);
    const candleH = candleW * 2.5;

    ctx.save();

    // Big golden glowing halo around corner Shamash
    const aura = ctx.createRadialGradient(x, y, 8, x, y, candleW * 3.1 * pulse);
    aura.addColorStop(0, 'rgba(253, 224, 71, 0.65)');
    aura.addColorStop(0.55, 'rgba(249, 115, 22, 0.35)');
    aura.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(x, y, candleW * 3.1 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Dashed interactive ring
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(x, y, candleW * 2.35 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Large golden Shamash candle body
    const bodyTop = y - candleH * 0.3;
    const grad = ctx.createLinearGradient(x - candleW / 2, bodyTop, x + candleW / 2, bodyTop);
    grad.addColorStop(0, '#FDE047');
    grad.addColorStop(0.5, '#FEF9C3');
    grad.addColorStop(1, '#F59E0B');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - candleW * 0.5, bodyTop, candleW, candleH, 6);
    ctx.fill();

    // Live big flame on corner Shamash
    this.drawFlame(ctx, x, bodyTop - 6, candleW * 0.95, now, 77);

    // Clear "גע בי!" label
    const shamashFontSize = Math.max(14, Math.min(20, Math.round(viewW * 0.024)));
    ctx.font = `800 ${shamashFontSize}px Fredoka, Rubik, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(9, 18, 44, 0.92)';
    const labelY = bodyTop + candleH + 24;
    ctx.strokeText('גע בי!', x, labelY, viewW * 0.36);
    ctx.fillStyle = '#FEF08A';
    ctx.fillText('גע בי!', x, labelY, viewW * 0.36);

    ctx.restore();
  }

  private drawHeldShamash(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    viewW: number,
    now: number
  ): void {
    const candleW = Math.max(22, viewW * 0.022);
    const candleH = candleW * 2.6;

    ctx.save();
    // Slight natural tilt as if held in hand
    ctx.translate(x, y);
    ctx.rotate(-0.12);

    // Warm hand aura
    const aura = ctx.createRadialGradient(0, -candleH * 0.35, 5, 0, -candleH * 0.35, candleW * 2.8);
    aura.addColorStop(0, 'rgba(253, 224, 71, 0.55)');
    aura.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -candleH * 0.35, candleW * 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Candle body centered on player's palm
    const bodyTop = -candleH * 0.45;
    const grad = ctx.createLinearGradient(-candleW / 2, bodyTop, candleW / 2, bodyTop);
    grad.addColorStop(0, '#FBBF24');
    grad.addColorStop(0.5, '#FEF9C3');
    grad.addColorStop(1, '#D97706');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-candleW * 0.5, bodyTop, candleW, candleH, 6);
    ctx.fill();

    ctx.strokeStyle = '#FEF08A';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Big bright flame on the held Shamash
    this.drawFlame(ctx, 0, bodyTop - 6, candleW * 1.05, now, 88);

    ctx.restore();
  }

  private drawFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    now: number,
    seed: number
  ): void {
    const sway = Math.sin(now * 0.014 + seed * 1.7) * size * 0.24;
    const stretch = 1 + Math.sin(now * 0.02 + seed) * 0.14;

    ctx.save();
    const halo = ctx.createRadialGradient(x, y - size * 0.6, 2, x, y - size * 0.6, size * 2.5);
    halo.addColorStop(0, 'rgba(251, 191, 36, 0.58)');
    halo.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.6, size * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F97316';
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.25);
    ctx.quadraticCurveTo(x - size * 0.85, y - size * 0.4, x + sway, y - size * 1.85 * stretch);
    ctx.quadraticCurveTo(x + size * 0.85, y - size * 0.4, x, y + size * 0.25);
    ctx.fill();

    ctx.fillStyle = '#FEF08A';
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.12);
    ctx.quadraticCurveTo(x - size * 0.42, y - size * 0.3, x + sway * 0.6, y - size * 1.15 * stretch);
    ctx.quadraticCurveTo(x + size * 0.42, y - size * 0.3, x, y + size * 0.12);
    ctx.fill();

    ctx.restore();
  }
}
