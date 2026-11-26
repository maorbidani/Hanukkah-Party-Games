import { soundEngine } from '../audio/soundEngine';
import { PlayerScores, PlayerSide } from '../types/game';
import { MotionDetector } from '../vision/motionDetector';

interface DreidelState {
  angle: number; // radians
  angularVelocity: number; // rad/s
  accumulatedAngle: number;
  rotations: number;
  tilt: number;
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

const DREIDEL_LETTERS = ['נ', 'ג', 'ה', 'פ'];

export class DreidelGame {
  private dreidels: Record<PlayerSide, DreidelState> = {
    left: {
      angle: 0,
      angularVelocity: 0,
      accumulatedAngle: 0,
      rotations: 0,
      tilt: 0,
      colorScheme: { primary: '#0284C7', secondary: '#38BDF8', accent: '#FACC15' },
    },
    right: {
      angle: 0,
      angularVelocity: 0,
      accumulatedAngle: 0,
      rotations: 0,
      tilt: 0,
      colorScheme: { primary: '#7C3AED', secondary: '#A78BFA', accent: '#FACC15' },
    },
  };

  public reset(): void {
    this.dreidels.left.angle = 0;
    this.dreidels.left.angularVelocity = 0;
    this.dreidels.left.accumulatedAngle = 0;
    this.dreidels.left.rotations = 0;
    this.dreidels.left.tilt = 0;

    this.dreidels.right.angle = 0;
    this.dreidels.right.angularVelocity = 0;
    this.dreidels.right.accumulatedAngle = 0;
    this.dreidels.right.rotations = 0;
    this.dreidels.right.tilt = 0;
  }

  public update(
    dt: number,
    _width: number,
    _height: number,
    motion: MotionDetector,
    scores: PlayerScores
  ): boolean {
    let scoreChanged = false;
    let maxSpeed = 0;

    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const d = this.dreidels[side];
      const halfEnergy = motion.getHalfMotion(side);

      // Motion accelerates the dreidel; lack of motion lets friction slow it down smoothly
      if (halfEnergy > 0.012) {
        const boost = Math.min(48, halfEnergy * 420);
        d.angularVelocity = Math.min(44, d.angularVelocity + boost * dt * 2.6);
      }

      // Gradual deceleration when no motion
      const friction = Math.pow(0.42, dt);
      d.angularVelocity *= friction;
      if (d.angularVelocity < 0.08) {
        d.angularVelocity = 0;
      }

      const deltaAngle = d.angularVelocity * dt;
      d.angle += deltaAngle;
      d.accumulatedAngle += deltaAngle;

      // Wobble tilt slightly when spinning slowly, stabilize upright when spinning fast
      const speedRatio = Math.min(1, d.angularVelocity / 32);
      d.tilt = Math.sin(performance.now() * 0.008) * (1 - speedRatio) * 0.08;

      const fullRotations = Math.floor(d.accumulatedAngle / (Math.PI * 2));
      if (fullRotations > d.rotations) {
        d.rotations = fullRotations;
        scores[side] = fullRotations;
        scoreChanged = true;
      }

      if (d.angularVelocity > maxSpeed) {
        maxSpeed = d.angularVelocity;
      }
    });

    if (maxSpeed > 4.5) {
      soundEngine.playDreidelWhistle(Math.min(1, maxSpeed / 36));
    }

    return scoreChanged;
  }

  public draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    (['left', 'right'] as PlayerSide[]).forEach((side) => {
      const d = this.dreidels[side];
      const cx = (side === 'left' ? 0.25 : 0.75) * width;
      const cy = height * 0.53;
      const size = Math.min(width * 0.14, height * 0.24);
      const speedRatio = Math.min(1, d.angularVelocity / 34);

      ctx.save();
      ctx.translate(cx, cy);

      // Speedometer arc / momentum glow ring around dreidel
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.48, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

      if (speedRatio > 0.01) {
        const endAngle = Math.PI * 0.75 + speedRatio * Math.PI * 1.5;
        const arcGrad = ctx.createLinearGradient(-size, 0, size, 0);
        arcGrad.addColorStop(0, '#38BDF8');
        arcGrad.addColorStop(0.5, '#FACC15');
        arcGrad.addColorStop(1, '#F97316');
        ctx.strokeStyle = arcGrad;
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.48, Math.PI * 0.75, endAngle);
        ctx.stroke();
      }
      ctx.restore();

      // Wind swirl streaks when spinning fast
      if (speedRatio > 0.2) {
        ctx.save();
        ctx.strokeStyle = `rgba(253, 224, 71, ${speedRatio * 0.55})`;
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const ringY = -size * 0.35 + i * size * 0.38;
          const startA = d.angle * 1.5 + i * 2.1;
          ctx.beginPath();
          ctx.ellipse(0, ringY, size * (0.95 + speedRatio * 0.25), size * 0.18, 0, startA, startA + 1.4);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Apply subtle wobble tilt
      ctx.rotate(d.tilt);

      // Draw pseudo-3D rotating Dreidel
      this.drawDreidelBody(ctx, size, d.angle, d.colorScheme);

      ctx.restore();

      // Speed & instruction badge under dreidel
      ctx.save();
      ctx.textAlign = 'center';
      const fontSize = Math.max(13, Math.min(20, Math.round(width * 0.024)));
      ctx.font = `700 ${fontSize}px Rubik, sans-serif`;
      const rpm = Math.round((d.angularVelocity / (Math.PI * 2)) * 60);
      ctx.fillStyle = speedRatio > 0.15 ? '#FDE047' : 'rgba(226, 232, 240, 0.85)';
      ctx.fillText(
        speedRatio > 0.08 ? `מהירות: ${rpm} סל"ד` : 'הניעו ידיים מהר כדי לסובב!',
        cx,
        cy + size * 1.52,
        width * 0.44
      );
      ctx.restore();
    });
  }

  private drawDreidelBody(
    ctx: CanvasRenderingContext2D,
    size: number,
    angle: number,
    colors: { primary: string; secondary: string; accent: string }
  ): void {
    const bodyW = size * 0.92;
    const bodyH = size * 0.92;
    const topY = -bodyH * 0.52;
    const botY = bodyH * 0.38;

    // Top handle (stem)
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.roundRect(-size * 0.12, topY - size * 0.42, size * 0.24, size * 0.44, 6);
    ctx.fill();
    ctx.strokeStyle = '#92400E';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Handle spinning highlight stripe
    const handlePhase = Math.cos(angle);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(handlePhase * size * 0.05 - 2, topY - size * 0.4, 4, size * 0.4);

    // 4-sided 3D projection for the cubic body
    const normAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const halfW = bodyW * 0.62;

    const faces = DREIDEL_LETTERS.map((letter, idx) => {
      const faceAngle = normAngle + idx * (Math.PI / 2);
      const x1 = Math.sin(faceAngle - Math.PI / 4) * halfW;
      const x2 = Math.sin(faceAngle + Math.PI / 4) * halfW;
      const depth = Math.cos(faceAngle);
      return { letter, x1, x2, depth, idx };
    }).filter((f) => f.depth > -0.15);

    faces.sort((a, b) => a.depth - b.depth);

    for (const face of faces) {
      const leftX = Math.min(face.x1, face.x2);
      const faceWidth = Math.abs(face.x2 - face.x1);
      if (faceWidth < 2) continue;

      ctx.fillStyle = face.idx % 2 === 0 ? colors.primary : colors.secondary;
      ctx.beginPath();
      ctx.rect(leftX, topY, faceWidth, botY - topY);
      ctx.fill();

      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Letter scaled horizontally to match face perspective
      const scaleX = faceWidth / (halfW * 1.414);
      if (scaleX > 0.18) {
        ctx.save();
        ctx.translate((face.x1 + face.x2) / 2, (topY + botY) / 2);
        ctx.scale(scaleX, 1);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `800 ${Math.round(size * 0.56)}px Fredoka, Rubik, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(face.letter, 0, 2);
        ctx.restore();
      }
    }

    // Top pyramid cap
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.72, topY);
    ctx.lineTo(0, topY - size * 0.12);
    ctx.lineTo(halfW * 0.72, topY);
    ctx.closePath();
    ctx.fill();

    // Conical bottom spinning tip
    const tipGrad = ctx.createLinearGradient(-halfW * 0.7, botY, halfW * 0.7, botY);
    tipGrad.addColorStop(0, colors.primary);
    tipGrad.addColorStop(0.5, colors.accent);
    tipGrad.addColorStop(1, colors.primary);
    ctx.fillStyle = tipGrad;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.72, botY);
    ctx.lineTo(halfW * 0.72, botY);
    ctx.lineTo(0, botY + size * 0.56);
    ctx.closePath();
    ctx.fill();

    // Spinning point glow
    ctx.fillStyle = '#FEF08A';
    ctx.beginPath();
    ctx.arc(0, botY + size * 0.56, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
