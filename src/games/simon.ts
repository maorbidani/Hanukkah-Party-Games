import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface TorchConfig {
  id: number;
  label: string;
  color: string;
  glow: string;
  relX: number; // Relative X inside player's half (0..1)
  relY: number; // Screen Y (0..1)
}

interface PlayerSimonState {
  phase: 'SHOW' | 'INPUT' | 'SUCCESS' | 'ERROR';
  sequence: number[];
  showIndex: number;
  showLit: boolean;
  phaseTimer: number;
  inputIndex: number;
  litTorchId: number | null;
  touchCooldown: number;
  lastTouchedTorch: number | null;
  level: number;
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

const TORCHES: TorchConfig[] = [
  { id: 0, label: 'אדום', color: '#EF4444', glow: 'rgba(239, 68, 68, 0.75)', relX: 0.28, relY: 0.38 },
  { id: 1, label: 'כחול', color: '#3B82F6', glow: 'rgba(59, 130, 246, 0.75)', relX: 0.72, relY: 0.38 },
  { id: 2, label: 'ירוק', color: '#22C55E', glow: 'rgba(34, 197, 94, 0.75)', relX: 0.28, relY: 0.68 },
  { id: 3, label: 'צהוב', color: '#FACC15', glow: 'rgba(250, 204, 21, 0.8)', relX: 0.72, relY: 0.68 },
];

export class SimonGame {
  private players: Record<PlayerSide, PlayerSimonState> = {
    left: this.createPlayerState(),
    right: this.createPlayerState(),
  };
  private sparks: Spark[] = [];
  private popups: FloatingText[] = [];

  private createPlayerState(): PlayerSimonState {
    return {
      phase: 'SHOW',
      sequence: this.generateSequence(2),
      showIndex: 0,
      showLit: false,
      phaseTimer: 0.35,
      inputIndex: 0,
      litTorchId: null,
      touchCooldown: 0,
      lastTouchedTorch: null,
      level: 1,
    };
  }

  private generateSequence(length: number): number[] {
    const seq: number[] = [];
    for (let i = 0; i < length; i++) {
      seq.push(Math.floor(Math.random() * 4));
    }
    return seq;
  }

  public reset(): void {
    this.players = {
      left: this.createPlayerState(),
      right: this.createPlayerState(),
    };
    this.sparks = [];
    this.popups = [];
  }

  private getTorchScreenNorm(side: PlayerSide, torch: TorchConfig): { nx: number; ny: number } {
    const halfBase = side === 'left' ? 0 : 0.5;
    return {
      nx: halfBase + torch.relX * 0.5,
      ny: torch.relY,
    };
  }

  private spawnSparks(xPx: number, yPx: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 190;
      this.sparks.push({
        x: xPx,
        y: yPx,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 45,
        size: 3 + Math.random() * 4.5,
        color: i % 3 === 0 ? '#FEF08A' : color,
        alpha: 1,
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
    const aspect = width / Math.max(1, height);

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const st = this.players[side];
      st.phaseTimer -= dt;
      if (st.touchCooldown > 0) {
        st.touchCooldown = Math.max(0, st.touchCooldown - dt);
      }

      if (st.phase === 'SHOW') {
        if (st.phaseTimer <= 0) {
          if (!st.showLit) {
            // Light up next torch in sequence
            if (st.showIndex < st.sequence.length) {
              const torchId = st.sequence[st.showIndex];
              st.litTorchId = torchId;
              st.showLit = true;
              st.phaseTimer = 0.55;
              soundEngine.playTorchTone(torchId);
            } else {
              // Done showing full sequence -> wait for player input
              st.phase = 'INPUT';
              st.inputIndex = 0;
              st.litTorchId = null;
              st.touchCooldown = 0.25;
              st.lastTouchedTorch = null;
            }
          } else {
            // Brief dark gap between sequence items
            st.litTorchId = null;
            st.showLit = false;
            st.showIndex++;
            st.phaseTimer = 0.22;
          }
        }
      } else if (st.phase === 'INPUT') {
        if (st.touchCooldown <= 0.18) {
          st.litTorchId = null;
        }

        // Check if hand left previous torch hitbox to allow intentional repeat colors
        if (st.lastTouchedTorch !== null) {
          const prevTorch = TORCHES[st.lastTouchedTorch];
          const pos = this.getTorchScreenNorm(side, prevTorch);
          const stillInside = motion.getRegionMotion(pos.nx, pos.ny, 0.08, 0.08 * aspect) > 0.1;
          if (!stillInside) {
            st.lastTouchedTorch = null;
          }
        }

        if (st.touchCooldown <= 0) {
          // Check all 4 torches with generous 3x wide hitbox
          const rx = 0.085;
          const ry = 0.085 * aspect;

          for (const torch of TORCHES) {
            if (st.lastTouchedTorch === torch.id) continue;

            const pos = this.getTorchScreenNorm(side, torch);
            const hit = motion.getRegionMotion(pos.nx, pos.ny, rx, ry) > 0.08;

            if (hit) {
              const expectedId = st.sequence[st.inputIndex];
              st.litTorchId = torch.id;
              st.lastTouchedTorch = torch.id;
              st.touchCooldown = 0.42;

              if (torch.id === expectedId) {
                soundEngine.playTorchTone(torch.id);
                this.spawnSparks(pos.nx * width, pos.ny * height, torch.color, 18);
                st.inputIndex++;

                if (st.inputIndex >= st.sequence.length) {
                  // Sequence completed! Award points equal to sequence length
                  const pts = st.sequence.length;
                  scores[side] += pts;
                  scoreChanged = true;
                  soundEngine.playHanukkiahComplete();
                  const centerX = (side === 'left' ? 0.25 : 0.75) * width;
                  this.popups.push({
                    x: centerX,
                    y: height * 0.52,
                    text: `+${pts}!`,
                    color: '#4ADE80',
                    alpha: 1,
                    vy: -70,
                  });
                  st.phase = 'SUCCESS';
                  st.phaseTimer = 0.8;
                }
              } else {
                // Wrong torch -> gentle buzz and replay current sequence
                soundEngine.playWrongTorch();
                st.phase = 'ERROR';
                st.phaseTimer = 0.85;
              }
              break;
            }
          }
        }
      } else if (st.phase === 'SUCCESS') {
        if (st.phaseTimer <= 0) {
          st.level++;
          st.sequence = this.generateSequence(Math.min(8, 1 + st.level));
          st.showIndex = 0;
          st.showLit = false;
          st.litTorchId = null;
          st.phase = 'SHOW';
          st.phaseTimer = 0.35;
        }
      } else if (st.phase === 'ERROR') {
        if (st.phaseTimer <= 0) {
          // Replay the same sequence so the player can try again
          st.showIndex = 0;
          st.showLit = false;
          st.litTorchId = null;
          st.phase = 'SHOW';
          st.phaseTimer = 0.35;
        }
      }
    });

    const activeSparks: Spark[] = [];
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 220 * dt;
      s.alpha -= 1.6 * dt;
      if (s.alpha > 0.02) activeSparks.push(s);
    }
    this.sparks = activeSparks;

    const activePopups: FloatingText[] = [];
    for (const pop of this.popups) {
      pop.y += pop.vy * dt;
      pop.alpha -= 1.15 * dt;
      if (pop.alpha > 0.02) activePopups.push(pop);
    }
    this.popups = activePopups;

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const now = performance.now();

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const st = this.players[side];
      const centerX = (side === 'left' ? 0.25 : 0.75) * width;
      const baseRadius = Math.max(34, Math.min(width * 0.045, height * 0.075));

      for (const torch of TORCHES) {
        const pos = this.getTorchScreenNorm(side, torch);
        const cx = pos.nx * width;
        const cy = pos.ny * height;
        const isLit = st.litTorchId === torch.id;

        this.drawTorch(ctx, cx, cy, baseRadius, torch, isLit, now);
      }

      // Status banner under torches
      const statusFontSize = Math.max(13, Math.min(22, Math.round(width * 0.025)));
      const maxBannerW = width * 0.44;
      ctx.save();
      ctx.font = `800 ${statusFontSize}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(9, 18, 44, 0.9)';

      let statusText = '';
      let statusColor = '#FEF08A';
      if (st.phase === 'SHOW') {
        statusText = `שלב ${st.level} · הסתכלו על האורות!`;
        statusColor = '#38BDF8';
      } else if (st.phase === 'INPUT') {
        statusText = `תורכם! (${st.inputIndex}/${st.sequence.length})`;
        statusColor = '#FEF08A';
      } else if (st.phase === 'SUCCESS') {
        statusText = 'כל הכבוד! עולים שלב!';
        statusColor = '#4ADE80';
      } else {
        statusText = 'אופס! ננסה שוב...';
        statusColor = '#FB7185';
      }

      ctx.strokeText(statusText, centerX, height * 0.89, maxBannerW);
      ctx.fillStyle = statusColor;
      ctx.fillText(statusText, centerX, height * 0.89, maxBannerW);
      ctx.restore();
    });

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
      ctx.font = '800 42px Fredoka, Rubik, sans-serif';
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

  private drawTorch(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    torch: TorchConfig,
    isLit: boolean,
    now: number
  ): void {
    ctx.save();

    // Bright halo when torch is lit
    if (isLit) {
      const aura = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
      aura.addColorStop(0, '#FFFFFF');
      aura.addColorStop(0.35, torch.glow);
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Torch bowl / wooden handle
    ctx.fillStyle = '#78350F';
    ctx.beginPath();
    ctx.roundRect(x - r * 0.16, y + r * 0.35, r * 0.32, r * 0.65, 5);
    ctx.fill();

    // Colored orb head
    ctx.fillStyle = isLit ? torch.color : 'rgba(15, 23, 42, 0.72)';
    ctx.strokeStyle = torch.color;
    ctx.lineWidth = isLit ? 6 : 4;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner bright glow or flame when lit
    if (isLit) {
      const sway = Math.sin(now * 0.02 + torch.id) * r * 0.15;
      ctx.fillStyle = '#FEF9C3';
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.22);
      ctx.quadraticCurveTo(x - r * 0.42, y - r * 0.15, x + sway, y - r * 0.92);
      ctx.quadraticCurveTo(x + r * 0.42, y - r * 0.15, x, y + r * 0.22);
      ctx.fill();
    } else {
      ctx.fillStyle = torch.color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
