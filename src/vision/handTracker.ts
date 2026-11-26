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

const PROC_W = 480;
const PROC_H = 360;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private status: HandTrackerState['status'] = 'idle';
  private lastVideoTime: number = -1;
  private fingers: TrackedFinger[] = [];
  private prevFingers: TrackedFinger[] = [];
  private trailSparks: TrailSpark[] = [];
  private lastUpdateMs: number = 0;
  private lastSuccessDetectMs: number = 0;
  private nextDetectAllowedMs: number = 0;
  private procCanvas: HTMLCanvasElement | null = null;
  private procCtx: CanvasRenderingContext2D | null = null;

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
            minHandDetectionConfidence: 0.25,
            minHandPresenceConfidence: 0.25,
            minTrackingConfidence: 0.25,
          });
        } catch {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.25,
            minHandPresenceConfidence: 0.25,
            minTrackingConfidence: 0.25,
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
      // Gently predict/sync prevNormX while waiting for next camera frame
      for (const f of this.fingers) {
        f.prevNormX = f.normX;
        f.prevNormY = f.normY;
      }
      return;
    }

    // Adaptive CPU/GPU pacing: if previous MediaPipe call was heavy (>18ms), skip one frame and coast smoothly
    if (now < this.nextDetectAllowedMs) {
      for (const f of this.fingers) {
        f.prevNormX = f.normX;
        f.prevNormY = f.normY;
        f.normX = Math.max(0.02, Math.min(0.98, f.normX + f.vx * dt * 0.45));
        f.normY = Math.max(0.02, Math.min(0.98, f.normY + f.vy * dt * 0.45));
      }
      return;
    }

    this.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    let result;
    try {
      // Ensure MediaPipe never processes heavier frames than 480x360 on mobile CPUs
      let inputSource: HTMLVideoElement | HTMLCanvasElement = video;
      if (video.videoWidth > PROC_W || video.videoHeight > PROC_H) {
        if (!this.procCanvas && typeof document !== 'undefined') {
          this.procCanvas = document.createElement('canvas');
          this.procCanvas.width = PROC_W;
          this.procCanvas.height = PROC_H;
          this.procCtx = this.procCanvas.getContext('2d');
        }
        if (this.procCanvas && this.procCtx) {
          this.procCtx.drawImage(video, 0, 0, PROC_W, PROC_H);
          inputSource = this.procCanvas;
        }
      }
      result = this.landmarker.detectForVideo(inputSource, now);
    } catch {
      return;
    }
    const inferMs = performance.now() - t0;
    // On fast devices (<18ms), run at full video rate; on slower CPUs, pace gently to protect 60fps rendering
    this.nextDetectAllowedMs = inferMs > 18 ? now + Math.min(36, inferMs * 1.1) : 0;

    const detected: TrackedFinger[] = [];
    const hands = result.landmarks ?? [];

    if (hands.length === 0) {
      // Brief 140ms hold so a single motion-blurred frame doesn't freeze or snap controls
      if (now - this.lastSuccessDetectMs < 140 && this.fingers.length > 0) {
        for (const f of this.fingers) {
          f.prevNormX = f.normX;
          f.prevNormY = f.normY;
          f.vx *= 0.7;
          f.vy *= 0.7;
          f.speed = Math.hypot(f.vx, f.vy);
        }
      } else {
        this.fingers = [];
        this.prevFingers = [];
      }
      return;
    }

    this.lastSuccessDetectMs = now;
    const lerpFactor = Math.min(1, Math.max(0.42, dt * 28));

    for (let i = 0; i < hands.length; i++) {
      const landmarks = hands[i];
      // Landmark 9 = Middle Finger MCP (stable center of palm, stays locked during rapid swings)
      const palmCenter = landmarks[9] || landmarks[0] || landmarks[8];
      if (!palmCenter) continue;

      const { normX: rawNormX, normY: rawNormY } = this.mapToMirroredViewport(
        palmCenter.x,
        palmCenter.y,
        video.videoWidth,
        video.videoHeight,
        viewW,
        viewH
      );

      // Match nearest previous hand to apply snappy Lerp smoothing & compute continuous velocity
      let prevMatch: TrackedFinger | null = null;
      let bestDist = 0.28;
      for (const prev of this.prevFingers) {
        const d = Math.hypot(rawNormX - prev.normX, rawNormY - prev.normY);
        if (d < bestDist) {
          bestDist = d;
          prevMatch = prev;
        }
      }

      const prevNormX = prevMatch ? prevMatch.normX : rawNormX;
      const prevNormY = prevMatch ? prevMatch.normY : rawNormY;
      // Snappy Lerp reduces 2-meter micro-jitter while preserving immediate responsiveness
      const normX = prevMatch ? prevNormX + (rawNormX - prevNormX) * lerpFactor : rawNormX;
      const normY = prevMatch ? prevNormY + (rawNormY - prevNormY) * lerpFactor : rawNormY;
      const vx = prevMatch ? (normX - prevNormX) / Math.max(0.016, dt) : 0;
      const vy = prevMatch ? (normY - prevNormY) / Math.max(0.016, dt) : 0;

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

      // Emit magic fireball/spark trail particles from palm center (capped for 60fps)
      if (this.trailSparks.length < 45) {
        const px = normX * viewW;
        const py = normY * viewH;
        const sparkCount = speed > 0.25 ? 2 : 1;
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
    }

    this.prevFingers = detected;
    this.fingers = detected;
  }

  /**
   * Draws a luminous 50px+ neon ring & fireball core at each detected palm center (Landmark 9)
   * so players standing 2 meters away can spot their exact hand cursor in ALL games.
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

    const pulse = 1 + Math.sin(this.lastUpdateMs * 0.012) * 0.1;
    // Guaranteed minimum 50px diameter neon ring (25px radius) visible from 2 meters away
    const ringRadius = Math.max(25, Math.min(34, viewW * 0.025));

    for (const finger of this.fingers) {
      const x = finger.normX * viewW;
      const y = finger.normY * viewH;
      const isLeft = finger.side === 'left';

      const neonStroke = isLeft ? '#00F0FF' : '#FFD700';
      const outerColor = isLeft ? 'rgba(0, 240, 255, 0.72)' : 'rgba(255, 215, 0, 0.75)';
      const midColor = isLeft ? 'rgba(125, 211, 252, 0.95)' : 'rgba(253, 224, 71, 0.95)';

      ctx.save();

      // Big luminous outer aura
      const aura = ctx.createRadialGradient(x, y, 4, x, y, ringRadius * 2.1 * pulse);
      aura.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      aura.addColorStop(0.32, midColor);
      aura.addColorStop(0.65, outerColor);
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius * 2.1 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Bright 50px+ Neon Ring
      ctx.shadowColor = neonStroke;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = neonStroke;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Crisp inner white highlight ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius * 0.76 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating star crosshairs
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.lastUpdateMs * 0.004);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const rayLen = ringRadius * 1.18 * pulse;
      for (let r = 0; r < 4; r++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -rayLen * 0.45);
        ctx.lineTo(0, -rayLen);
        ctx.stroke();
      }
      ctx.restore();

      // Solid bright palm center dot
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }
}
