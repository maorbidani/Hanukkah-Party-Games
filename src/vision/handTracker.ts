import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HandTrackerState, PlayerSide } from '../types/game';

export interface TrackedFinger {
  id: number;
  normX: number; // Screen-aligned mirrored 0..1 (Landmark 9 palm center)
  normY: number; // Screen-aligned 0..1 (Landmark 9 palm center)
  prevNormX: number; // Previous frame X for continuous sweep collision
  prevNormY: number; // Previous frame Y for continuous sweep collision
  vx: number;
  vy: number;
  speed: number;
  side: PlayerSide;
}

interface TrailSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  color: string;
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private status: HandTrackerState['status'] = 'idle';
  private lastVideoTime: number = -1;
  private fingers: TrackedFinger[] = [];
  private prevFingers: TrackedFinger[] = [];
  private trailSparks: TrailSpark[] = [];
  private lastUpdateMs: number = 0;

  public getStatus(): HandTrackerState['status'] {
    return this.status;
  }

  public getFingers(): TrackedFinger[] {
    return this.fingers;
  }

  public async initialize(): Promise<void> {
    if (this.status === 'ready') return;
    if (this.initPromise) return this.initPromise;

    this.status = 'loading';
    this.initPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        try {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.4,
            minTrackingConfidence: 0.4,
          });
        } catch {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.4,
            minTrackingConfidence: 0.4,
          });
        }
        this.status = 'ready';
      } catch (err) {
        console.warn('MediaPipe HandLandmarker initialization failed, using motion fallback:', err);
        this.status = 'error';
      }
    })();

    return this.initPromise;
  }

  /**
   * Maps raw video normalized coordinates (0..1) into mirrored object-cover viewport coordinates (0..1).
   */
  private mapToMirroredViewport(
    rawX: number,
    rawY: number,
    videoW: number,
    videoH: number,
    viewW: number,
    viewH: number
  ): { normX: number; normY: number } {
    const mirroredX = 1 - rawX;
    if (videoW <= 0 || videoH <= 0 || viewW <= 0 || viewH <= 0) {
      return { normX: mirroredX, normY: rawY };
    }

    const videoAspect = videoW / videoH;
    const viewAspect = viewW / viewH;

    if (viewAspect > videoAspect) {
      const scale = viewW / videoW;
      const renderedH = videoH * scale;
      const offsetY = (viewH - renderedH) / 2;
      return {
        normX: mirroredX,
        normY: (rawY * renderedH + offsetY) / viewH,
      };
    } else {
      const scale = viewH / videoH;
      const renderedW = videoW * scale;
      const offsetX = (viewW - renderedW) / 2;
      return {
        normX: (mirroredX * renderedW + offsetX) / viewW,
        normY: rawY,
      };
    }
  }

  public update(video: HTMLVideoElement | null, viewW: number, viewH: number, dt: number): void {
    const now = performance.now();
    this.lastUpdateMs = now;

    // Update trailing sparks
    for (let i = this.trailSparks.length - 1; i >= 0; i--) {
      const sp = this.trailSparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.alpha -= 2.4 * dt;
      if (sp.alpha <= 0.02) {
        this.trailSparks.splice(i, 1);
      }
    }

    if (
      !this.landmarker ||
      this.status !== 'ready' ||
      !video ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      this.fingers = [];
      return;
    }

    if (video.currentTime === this.lastVideoTime) {
      // Keep prevNormX/prevNormY synced when frame hasn't advanced so we don't repeat stale sweeps
      for (const f of this.fingers) {
        f.prevNormX = f.normX;
        f.prevNormY = f.normY;
      }
      return;
    }
    this.lastVideoTime = video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, now);
    } catch {
      return;
    }

    const detected: TrackedFinger[] = [];
    const hands = result.landmarks ?? [];

    for (let i = 0; i < hands.length; i++) {
      const landmarks = hands[i];
      // Landmark 9 = Middle Finger MCP (stable center of palm, stays locked during rapid swings)
      const palmCenter = landmarks[9] || landmarks[0] || landmarks[8];
      if (!palmCenter) continue;

      const { normX, normY } = this.mapToMirroredViewport(
        palmCenter.x,
        palmCenter.y,
        video.videoWidth,
        video.videoHeight,
        viewW,
        viewH
      );

      // Match nearest previous hand to compute continuous path (prev -> curr) & velocity
      let prevNormX = normX;
      let prevNormY = normY;
      let vx = 0;
      let vy = 0;
      let bestDist = 0.28;
      for (const prev of this.prevFingers) {
        const d = Math.hypot(normX - prev.normX, normY - prev.normY);
        if (d < bestDist) {
          bestDist = d;
          prevNormX = prev.normX;
          prevNormY = prev.normY;
          vx = (normX - prev.normX) / Math.max(0.016, dt);
          vy = (normY - prev.normY) / Math.max(0.016, dt);
        }
      }

      const speed = Math.hypot(vx, vy);
      const side: PlayerSide = normX < 0.5 ? 'left' : 'right';

      detected.push({
        id: i,
        normX,
        normY,
        prevNormX,
        prevNormY,
        vx,
        vy,
        speed,
        side,
      });

      // Emit magic fireball/spark trail particles from palm center
      const px = normX * viewW;
      const py = normY * viewH;
      const sparkCount = speed > 0.25 ? 3 : 1;
      for (let s = 0; s < sparkCount; s++) {
        this.trailSparks.push({
          x: px + (Math.random() - 0.5) * 12,
          y: py + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 50,
          vy: -25 - Math.random() * 50,
          alpha: 0.9,
          size: 3 + Math.random() * 4,
          color: side === 'left' ? (s % 2 === 0 ? '#38BDF8' : '#FEF08A') : s % 2 === 0 ? '#FB923C' : '#FEF08A',
        });
      }
    }

    this.prevFingers = detected;
    this.fingers = detected;
  }

  /**
   * Draws a luminous magic fireball / spark orb at each detected palm center (Landmark 9).
   */
  public drawFingerOrbs(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    for (const sp of this.trailSparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.alpha);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const pulse = 1 + Math.sin(this.lastUpdateMs * 0.012) * 0.14;
    const baseRadius = Math.max(20, Math.min(30, viewW * 0.022));

    for (const finger of this.fingers) {
      const x = finger.normX * viewW;
      const y = finger.normY * viewH;
      const isLeft = finger.side === 'left';

      const outerColor = isLeft ? 'rgba(56, 189, 248, 0.85)' : 'rgba(249, 115, 22, 0.9)';
      const midColor = isLeft ? 'rgba(125, 211, 252, 0.95)' : 'rgba(251, 191, 36, 0.95)';

      ctx.save();

      const aura = ctx.createRadialGradient(x, y, 2, x, y, baseRadius * 2.5 * pulse);
      aura.addColorStop(0, '#FFFFFF');
      aura.addColorStop(0.25, midColor);
      aura.addColorStop(0.6, outerColor);
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, baseRadius * 2.5 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.lastUpdateMs * 0.004);
      ctx.strokeStyle = 'rgba(254, 249, 195, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const rayLen = baseRadius * 1.3 * pulse;
      for (let r = 0; r < 4; r++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -rayLen * 0.35);
        ctx.lineTo(0, -rayLen);
        ctx.stroke();
      }
      ctx.restore();

      ctx.fillStyle = '#FEF9C3';
      ctx.beginPath();
      ctx.arc(x, y, baseRadius * 0.45, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, baseRadius * 0.84, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }
}
