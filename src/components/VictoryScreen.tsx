import React, { useEffect, useRef } from 'react';
import { Home, RotateCcw } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { GameMode, GameResult } from '../types/game';

interface VictoryScreenProps {
  result: GameResult;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

interface FireworkRocket {
  x: number;
  y: number;
  targetY: number;
  vy: number;
  color: string;
}

interface FireworkSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  size: number;
}

const FIREWORK_COLORS = ['#FACC15', '#38BDF8', '#FB7185', '#4ADE80', '#C084FC', '#FB923C'];

const SCORE_UNITS: Record<GameMode, string> = {
  sufganiyot: 'נקודות',
  hanukkiah: 'חנוכיות',
  dreidel: 'סיבובים',
  maccabees: 'חסימות',
  coins: 'מטבעות',
  sugarwar: 'זריקות',
  simon: 'נקודות',
  sword: 'נקודות',
  duel: '% חיים',
};

const TrophySvg: React.FC = () => (
  <svg
    viewBox="0 0 180 180"
    className="w-24 h-24 sm:w-40 sm:h-40 drop-shadow-[0_12px_32px_rgba(250,204,21,0.65)] animate-trophy-bounce"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="45%" stopColor="#FACC15" />
        <stop offset="100%" stopColor="#B45309" />
      </linearGradient>
    </defs>
    <path
      d="M45 48 C18 48, 18 92, 48 96"
      fill="none"
      stroke="url(#goldGrad)"
      strokeWidth="12"
      strokeLinecap="round"
    />
    <path
      d="M135 48 C162 48, 162 92, 132 96"
      fill="none"
      stroke="url(#goldGrad)"
      strokeWidth="12"
      strokeLinecap="round"
    />
    <path
      d="M42 32 H138 L128 88 C124 112, 108 124, 90 126 C72 124, 56 112, 52 88 Z"
      fill="url(#goldGrad)"
      stroke="#FEF9C3"
      strokeWidth="3"
    />
    <polygon
      points="90,54 96,68 111,69 99,79 103,94 90,85 77,94 81,79 69,69 84,68"
      fill="#FFFBEB"
      opacity="0.92"
    />
    <rect x="80" y="124" width="20" height="24" rx="4" fill="url(#goldGrad)" />
    <rect x="52" y="146" width="76" height="16" rx="6" fill="url(#goldGrad)" stroke="#FEF08A" strokeWidth="2" />
    <rect x="42" y="160" width="96" height="10" rx="4" fill="#78350F" />
  </svg>
);

export const VictoryScreen: React.FC<VictoryScreenProps> = ({
  result,
  onPlayAgain,
  onBackToMenu,
}) => {
  const fireworksCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    soundEngine.playVictoryMusic();
    const timer = window.setTimeout(() => {
      void soundEngine.speakHebrew('כל הכבוד לאלופים! איזה משחק מטורף!', {
        rate: 0.95,
        pitch: 0.78,
        volume: 1.0,
      });
    }, 550);

    return () => {
      window.clearTimeout(timer);
      soundEngine.stopSpeech();
    };
  }, []);

  useEffect(() => {
    const canvas = fireworksCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const rockets: FireworkRocket[] = [];
    const sparks: FireworkSpark[] = [];
    let spawnTimer = 0.05;
    let lastTime = performance.now();
    let rafId = 0;

    const launchRocket = () => {
      const w = canvas.width;
      const h = canvas.height;
      rockets.push({
        x: w * (0.12 + Math.random() * 0.76),
        y: h + 10,
        targetY: h * (0.14 + Math.random() * 0.36),
        vy: -(480 + Math.random() * 240),
        color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
      });
    };

    const explode = (rocket: FireworkRocket) => {
      const count = 48;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
        const speed = 90 + Math.random() * 240;
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: i % 5 === 0 ? '#FEF08A' : rocket.color,
          alpha: 1,
          size: 2.5 + Math.random() * 3.5,
        });
      }
    };

    launchRocket();
    launchRocket();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        launchRocket();
        spawnTimer = 0.42 + Math.random() * 0.35;
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy * dt;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
        ctx.fill();

        if (r.y <= r.targetY) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 170 * dt;
        s.vx *= 0.985;
        s.alpha -= 0.85 * dt;

        if (s.alpha <= 0.02) {
          sparks.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const { left, right } = result.scores;
  const winner: 'left' | 'right' | 'tie' =
    left > right ? 'left' : right > left ? 'right' : 'tie';
  const unit = SCORE_UNITS[result.mode];
  const isKnockout = result.mode === 'duel' && (left <= 0 || right <= 0);

  const headline =
    winner === 'right'
      ? isKnockout
        ? 'נוקאאוט! שחקן ימין ניצח!'
        : 'שחקן ימין ניצח!'
      : winner === 'left'
      ? isKnockout
        ? 'נוקאאוט! שחקן שמאל ניצח!'
        : 'שחקן שמאל ניצח!'
      : 'תיקו חגיגי! שניכם אלופים!';

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-between overflow-y-auto bg-slate-950/75 backdrop-blur-sm">
      <canvas
        ref={fireworksCanvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-10"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-amber-300/35 z-10"
      />

      <div className="relative z-20 w-full max-w-6xl mx-auto px-4 py-4 sm:py-6 flex-1 flex flex-col items-center justify-between gap-3 sm:gap-5">
        <div className="text-center space-y-1.5 mt-1">
          <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-orange-400 drop-shadow-[0_4px_20px_rgba(251,191,36,0.45)]">
            {headline}
          </h1>
          <p className="text-base sm:text-xl text-sky-100 font-medium">
            {isKnockout
              ? 'ניצחון בנוקאאוט מוחץ בדו-קרב האלופים!'
              : `תוצאות האליפות לאחר ${result.duration} שניות`}
          </p>
        </div>

        <div dir="ltr" className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-stretch my-auto">
          <div
            dir="rtl"
            className={`flex flex-col items-center justify-center p-5 sm:p-7 rounded-3xl border-2 transition-all ${
              winner === 'left' || winner === 'tie'
                ? 'bg-gradient-to-b from-sky-900/85 to-slate-900/90 border-amber-400 shadow-[0_0_45px_rgba(250,204,21,0.35)]'
                : 'bg-slate-900/75 border-sky-400/30 opacity-90'
            }`}
          >
            {(winner === 'left' || winner === 'tie') && <TrophySvg />}
            <span className="text-lg sm:text-2xl font-bold text-sky-300 mt-1.5">שחקן שמאל</span>
            <div className="font-display text-5xl sm:text-7xl font-extrabold text-white tabular-nums mt-1">
              {left}
            </div>
            <span className="text-sm sm:text-lg font-semibold text-sky-200 mt-1">{unit}</span>
          </div>

          <div
            dir="rtl"
            className={`flex flex-col items-center justify-center p-5 sm:p-7 rounded-3xl border-2 transition-all ${
              winner === 'right' || winner === 'tie'
                ? 'bg-gradient-to-b from-amber-900/80 to-slate-900/90 border-amber-400 shadow-[0_0_45px_rgba(250,204,21,0.35)]'
                : 'bg-slate-900/75 border-amber-400/30 opacity-90'
            }`}
          >
            {(winner === 'right' || winner === 'tie') && <TrophySvg />}
            <span className="text-lg sm:text-2xl font-bold text-amber-300 mt-1.5">שחקן ימין</span>
            <div className="font-display text-5xl sm:text-7xl font-extrabold text-white tabular-nums mt-1">
              {right}
            </div>
            <span className="text-sm sm:text-lg font-semibold text-amber-200 mt-1">{unit}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 pb-2">
          <button
            type="button"
            onClick={() => {
              leavingViaActionRef.current = true;
              soundEngine.stopSpeech();
              onBackToMenu();
            }}
            className="flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 font-extrabold text-lg sm:text-xl shadow-[0_10px_28px_rgba(251,191,36,0.4)] hover:scale-[1.03] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <Home className="w-5 h-5 sm:w-6 sm:h-6" />
            <span>חזרה לתפריט הראשי</span>
          </button>

          <button
            type="button"
            onClick={() => {
              leavingViaActionRef.current = true;
              soundEngine.stopSpeech();
              onPlayAgain();
            }}
            className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700 border-2 border-white/20 text-white font-bold text-lg sm:text-xl transition-all cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-5 h-5" />
            <span>סיבוב נוסף</span>
          </button>
        </div>
      </div>
    </div>
  );
};
