import { PlayerSide, SensitivityLevel } from '../types/game';
import { TrackedFinger } from './handTracker';

const GRID_W = 160;
const GRID_H = 90;

interface PointerSegment {
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
  strength: number;
  timestamp: number;
}

export class MotionDetector {
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private prevLuma: Float32Array | null = null;
  private lumaBufferA: Float32Array;
  private lumaBufferB: Float32Array;
  private useBufferA = true;
  private motionGrid: Float32Array;
  private pointerSegments: PointerSegment[] = [];
  private lastPointerPos: { x: number; y: number; time: number } | null = null;
  private trackedFingers: TrackedFinger[] = [];
  private sensitivity: SensitivityLevel = 'medium';

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = GRID_W;
    this.offscreenCanvas.height = GRID_H;
    const ctx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not initialize 2D context for motion detection');
    }
    this.offscreenCtx = ctx;
    this.lumaBufferA = new Float32Array(GRID_W * GRID_H);
    this.lumaBufferB = new Float32Array(GRID_W * GRID_H);
    this.motionGrid = new Float32Array(GRID_W * GRID_H);
  }

  public setSensitivity(level: SensitivityLevel): void {
    this.sensitivity = level;
  }

  public setTrackedFingers(fingers: TrackedFinger[]): void {
    this.trackedFingers = fingers;
  }

  public reset(): void {
    this.prevLuma = null;
    this.motionGrid.fill(0);
    this.pointerSegments = [];
    this.lastPointerPos = null;
    this.trackedFingers = [];
  }

  /**
   * Injects manual pointer/touch motion with previous-to-current path segment
   * so mouse/touch fallback also supports continuous sweep collision and holding the Shamash.
   */
  public addPointerImpulse(normX: number, normY: number, strength: number = 1.0): void {
    const x = Math.max(0, Math.min(1, normX));
    const y = Math.max(0, Math.min(1, normY));
    const now = performance.now();

    const prevX =
      this.lastPointerPos && now - this.lastPointerPos.time < 250
        ? this.lastPointerPos.x
        : x;
    const prevY =
      this.lastPointerPos && now - this.lastPointerPos.time < 250
        ? this.lastPointerPos.y
        : y;

    this.pointerSegments.push({
      prevX,
      prevY,
      currX: x,
      currY: y,
      strength,
      timestamp: now,
    });
    this.lastPointerPos = { x, y, time: now };
  }

  private getThreshold(): number {
    switch (this.sensitivity) {
      case 'high':
        return 12;
      case 'low':
        return 28;
      case 'medium':
      default:
        return 18;
    }
  }

  /**
   * Checks whether a line segment (ax, ay) -> (bx, by) intersects an ellipse
   * centered at (cx, cy) with radii (rx, ry).
   */
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

    let t = 0;
    if (lenSq > 1e-8) {
      t = Math.max(0, Math.min(1, -(axp * abx + ayp * aby) / lenSq));
    }

    const closestX = axp + t * abx;
    const closestY = ayp + t * aby;
    return closestX * closestX + closestY * closestY <= 1;
  }

  /**
   * Returns the primary hand position (MediaPipe palm center or recent pointer) on a player's half.
   */
  public getPrimaryHandPos(side: PlayerSide): { normX: number; normY: number } | null {
    const hand = this.trackedFingers.find((f) => f.side === side);
    if (hand) {
      return { normX: hand.normX, normY: hand.normY };
    }

    if (this.lastPointerPos && performance.now() - this.lastPointerPos.time < 2500) {
      const pSide: PlayerSide = this.lastPointerPos.x < 0.5 ? 'left' : 'right';
      if (pSide === side) {
        return { normX: this.lastPointerPos.x, normY: this.lastPointerPos.y };
      }
    }

    return null;
  }

  /**
   * Processes the current mirrored video frame (cropped to match object-cover viewport)
   * and updates the internal motion grid.
   */
  public update(video: HTMLVideoElement | null, viewW: number = 16, viewH: number = 9): void {
    for (let i = 0; i < this.motionGrid.length; i++) {
      this.motionGrid[i] *= 0.42;
    }

    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const viewAspect = viewW / Math.max(1, viewH);

      let sx = 0;
      let sy = 0;
      let sw = video.videoWidth;
      let sh = video.videoHeight;

      if (viewAspect > videoAspect) {
        sh = video.videoWidth / viewAspect;
        sy = (video.videoHeight - sh) / 2;
      } else {
        sw = video.videoHeight * viewAspect;
        sx = (video.videoWidth - sw) / 2;
      }

      this.offscreenCtx.save();
      this.offscreenCtx.translate(GRID_W, 0);
      this.offscreenCtx.scale(-1, 1);
      this.offscreenCtx.drawImage(video, sx, sy, sw, sh, 0, 0, GRID_W, GRID_H);
      this.offscreenCtx.restore();

      const imageData = this.offscreenCtx.getImageData(0, 0, GRID_W, GRID_H).data;
      const currentLuma = this.useBufferA ? this.lumaBufferA : this.lumaBufferB;
      this.useBufferA = !this.useBufferA;
      const threshold = this.getThreshold();

      for (let i = 0; i < GRID_W * GRID_H; i++) {
        const p = i * 4;
        const luma = 0.299 * imageData[p] + 0.587 * imageData[p + 1] + 0.114 * imageData[p + 2];
        currentLuma[i] = luma;

        if (this.prevLuma) {
          const diff = Math.abs(luma - this.prevLuma[i]);
          if (diff > threshold) {
            const intensity = Math.min(1, (diff - threshold) / 34);
            this.motionGrid[i] = Math.max(this.motionGrid[i], intensity);
          }
        }
      }

      this.prevLuma = currentLuma;
    }

    // Rasterize recent pointer segments into grid & clear stale segments (> 90ms)
    const now = performance.now();
    if (this.pointerSegments.length > 0) {
      const radiusCells = 6;
      for (const seg of this.pointerSegments) {
        const cx = Math.floor(seg.currX * GRID_W);
        const cy = Math.floor(seg.currY * GRID_H);
        for (let dy = -radiusCells; dy <= radiusCells; dy++) {
          const gy = cy + dy;
          if (gy < 0 || gy >= GRID_H) continue;
          for (let dx = -radiusCells; dx <= radiusCells; dx++) {
            const gx = cx + dx;
            if (gx < 0 || gx >= GRID_W) continue;
            const dist = Math.hypot(dx, dy);
            if (dist <= radiusCells) {
              const idx = gy * GRID_W + gx;
              const falloff = 1 - dist / radiusCells;
              this.motionGrid[idx] = Math.max(this.motionGrid[idx], seg.strength * falloff);
            }
          }
        }
      }
      this.pointerSegments = this.pointerSegments.filter((s) => now - s.timestamp < 80);
    }
  }

  /**
   * Continuous frame-to-frame sweep collision against an elliptical target region.
   * Checks MediaPipe palm paths, pointer paths, and falls back to pixel-diff grid.
   */
  public getRegionMotion(normX: number, normY: number, normRadiusX: number, normRadiusY: number): number {
    // 1. Continuous path sweep for all MediaPipe tracked palms (Landmark 9)
    for (const finger of this.trackedFingers) {
      if (
        this.segmentIntersectsEllipse(
          finger.prevNormX,
          finger.prevNormY,
          finger.normX,
          finger.normY,
          normX,
          normY,
          normRadiusX,
          normRadiusY
        )
      ) {
        return 1.0;
      }
    }

    // 2. Continuous path sweep + recent direct pointer contact for pointer/mouse fallback
    if (this.lastPointerPos && performance.now() - this.lastPointerPos.time < 140) {
      const dx = (this.lastPointerPos.x - normX) / Math.max(0.001, normRadiusX);
      const dy = (this.lastPointerPos.y - normY) / Math.max(0.001, normRadiusY);
      if (dx * dx + dy * dy <= 1) {
        return 0.95;
      }
    }

    for (const seg of this.pointerSegments) {
      if (
        this.segmentIntersectsEllipse(
          seg.prevX,
          seg.prevY,
          seg.currX,
          seg.currY,
          normX,
          normY,
          normRadiusX,
          normRadiusY
        )
      ) {
        return 0.95;
      }
    }

    // 3. Pixel-diff grid fallback
    const minX = Math.max(0, Math.floor((normX - normRadiusX) * GRID_W));
    const maxX = Math.min(GRID_W - 1, Math.ceil((normX + normRadiusX) * GRID_W));
    const minY = Math.max(0, Math.floor((normY - normRadiusY) * GRID_H));
    const maxY = Math.min(GRID_H - 1, Math.ceil((normY + normRadiusY) * GRID_H));

    let activeSum = 0;
    let peakVal = 0;
    let totalCount = 0;

    for (let gy = minY; gy <= maxY; gy++) {
      const ny = (gy + 0.5) / GRID_H;
      const dy = (ny - normY) / normRadiusY;
      for (let gx = minX; gx <= maxX; gx++) {
        const nx = (gx + 0.5) / GRID_W;
        const dx = (nx - normX) / normRadiusX;
        if (dx * dx + dy * dy <= 1) {
          totalCount++;
          const val = this.motionGrid[gy * GRID_W + gx];
          if (val > 0.12) {
            activeSum += val;
            if (val > peakVal) peakVal = val;
          }
        }
      }
    }

    if (totalCount === 0) return 0;
    return Math.max(activeSum / totalCount, peakVal * 0.55);
  }

  /**
   * Returns overall motion energy (0..1+) in the left or right half of the screen,
   * combining MediaPipe palm velocity with pixel-diff motion.
   */
  public getHalfMotion(side: 'left' | 'right'): number {
    let fingerBoost = 0;
    for (const finger of this.trackedFingers) {
      if (finger.side === side && finger.speed > 0.08) {
        fingerBoost = Math.max(fingerBoost, Math.min(0.22, finger.speed * 0.1));
      }
    }

    const startX = side === 'left' ? 0 : Math.floor(GRID_W / 2);
    const endX = side === 'left' ? Math.floor(GRID_W / 2) : GRID_W;

    let sum = 0;
    let count = 0;
    const startY = Math.floor(GRID_H * 0.14);

    for (let gy = startY; gy < GRID_H; gy++) {
      for (let gx = startX; gx < endX; gx++) {
        const val = this.motionGrid[gy * GRID_W + gx];
        if (val > 0.18) {
          sum += val;
        }
        count++;
      }
    }

    const gridEnergy = count > 0 ? sum / count : 0;
    return Math.max(gridEnergy, fingerBoost);
  }

  /**
   * Measures vigorous hand-waving velocity & energy (0..1.5+) for rapid-fire Duel attacks,
   * combining MediaPipe palm speeds across hands on that half with pixel-diff & pointer energy.
   */
  public getHalfSpeedScore(side: 'left' | 'right'): number {
    let handScore = 0;
    for (const finger of this.trackedFingers) {
      if (finger.side === side && finger.speed > 0.14) {
        handScore += Math.min(1.15, (finger.speed - 0.14) * 0.55);
      }
    }

    let pointerScore = 0;
    for (const seg of this.pointerSegments) {
      const segSide: PlayerSide = seg.currX < 0.5 ? 'left' : 'right';
      if (segSide === side) {
        const dist = Math.hypot(seg.currX - seg.prevX, seg.currY - seg.prevY);
        if (dist > 0.004) {
          pointerScore = Math.max(pointerScore, Math.min(1.25, dist * 16));
        }
      }
    }

    const startX = side === 'left' ? 0 : Math.floor(GRID_W / 2);
    const endX = side === 'left' ? Math.floor(GRID_W / 2) : GRID_W;
    const startY = Math.floor(GRID_H * 0.14);

    let sum = 0;
    let activeCells = 0;
    let count = 0;
    for (let gy = startY; gy < GRID_H; gy++) {
      for (let gx = startX; gx < endX; gx++) {
        const val = this.motionGrid[gy * GRID_W + gx];
        if (val > 0.18) {
          sum += val;
          activeCells++;
        }
        count++;
      }
    }

    const gridRatio = count > 0 ? (sum / count) * 4.2 + (activeCells / count) * 1.4 : 0;
    return Math.min(1.6, Math.max(handScore, pointerScore, gridRatio));
  }

  public drawMotionFeedback(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cellW = width / GRID_W;
    const cellH = height / GRID_H;
    const maxAlpha = this.trackedFingers.length > 0 ? 0.14 : 0.36;

    ctx.save();
    for (let gy = 0; gy < GRID_H; gy += 2) {
      for (let gx = 0; gx < GRID_W; gx += 2) {
        const val = this.motionGrid[gy * GRID_W + gx];
        if (val > 0.25) {
          const isLeft = gx < GRID_W / 2;
          const alpha = Math.min(maxAlpha, val * maxAlpha);
          ctx.fillStyle = isLeft
            ? `rgba(56, 189, 248, ${alpha})`
            : `rgba(251, 191, 36, ${alpha})`;
          ctx.beginPath();
          ctx.arc((gx + 1) * cellW, (gy + 1) * cellH, Math.max(4, cellW * 1.1), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}
