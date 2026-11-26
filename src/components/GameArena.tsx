import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, Volume2, VolumeX } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { CoinsGame } from '../games/coins';
import { DreidelGame } from '../games/dreidel';
import { HanukkiahGame } from '../games/hanukkiah';
import { MaccabeesGame } from '../games/maccabees';
import { DuelGame } from '../games/duel';
import { SimonGame } from '../games/simon';
import { SufganiyotGame } from '../games/sufganiyot';
import { SugarWarGame } from '../games/sugarwar';
import { SwordGame } from '../games/sword';
import {
  CameraState,
  GameDuration,
  GameMode,
  PlayerScores,
  SensitivityLevel,
} from '../types/game';
import { HandTracker } from '../vision/handTracker';
import { MotionDetector } from '../vision/motionDetector';
import { GameBriefingTutorial } from './GameBriefingTutorial';

interface GameArenaProps {
  mode: GameMode;
  duration: GameDuration;
  sensitivity: SensitivityLevel;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  handTrackerRef: React.RefObject<HandTracker>;
  cameraState: CameraState;
  onRequestCamera: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onExitToMenu: () => void;
  onGameEnd: (finalScores: PlayerScores) => void;
}

type ArenaPhase = 'BRIEFING' | 'COUNTDOWN' | 'ACTIVE';
type CountdownStep = 3 | 2 | 1 | 'GO';

const GAME_TITLES: Record<GameMode, string> = {
  sufganiyot: '🍩 אכול את הסופגניות',
  hanukkiah: '🕎 הדלק את החנוכיות',
  dreidel: '🌀 מרוץ הסביבונים',
  maccabees: '🛡️ מגן המכבים',
  coins: '🪙 שודדי המטבעות',
  sugarwar: '❄️ מלחמת אבקת סוכר',
  simon: '💡 זיכרון אורות',
  sword: '⚔️ חרב המכבים',
  duel: '🥊 דו-קרב האלופים',
};

const MEDIAPIPE_CAMERA_MODES: ReadonlySet<GameMode> = new Set<GameMode>([
  'sufganiyot',
  'hanukkiah',
  'dreidel',
  'maccabees',
  'coins',
  'sugarwar',
  'simon',
  'sword',
  'duel',
]);

const SCORE_UNITS: Record<GameMode, string> = {
  sufganiyot: 'נקודות',
  hanukkiah: 'חנוכיות',
  dreidel: 'סיבובים',
  maccabees: 'חסימות',
  coins: 'מטבעות',
  sugarwar: 'זריקות',
  simon: 'נקודות',
  sword: 'נקודות',
  duel: '%',
};

export const GameArena: React.FC<GameArenaProps> = ({
  mode,
  duration,
  sensitivity,
  videoRef,
  handTrackerRef,
  cameraState,
  onRequestCamera,
  muted,
  onToggleMute,
  onExitToMenu,
  onGameEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scores, setScores] = useState<PlayerScores>(() =>
    mode === 'duel' ? { left: 100, right: 100 } : { left: 0, right: 0 }
  );
  const [timeLeft, setTimeLeft] = useState<number>(duration);
  const [phase, setPhase] = useState<ArenaPhase>('BRIEFING');
  const [countdown, setCountdown] = useState<CountdownStep>(3);

  const motionRef = useRef<MotionDetector | null>(null);
  const scoresRef = useRef<PlayerScores>(mode === 'duel' ? { left: 100, right: 100 } : { left: 0, right: 0 });
  const endedRef = useRef<boolean>(false);
  const gameplayActiveRef = useRef<boolean>(false);
  const gameStartTimeRef = useRef<number>(0);
  const countdownStartedRef = useRef<boolean>(false);
  const countdownTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!motionRef.current) {
      motionRef.current = new MotionDetector();
    }
    motionRef.current.setSensitivity(sensitivity);
  }, [sensitivity]);

  const clearAllCountdownTimers = useCallback(() => {
    countdownTimersRef.current.forEach((id) => window.clearTimeout(id));
    countdownTimersRef.current = [];
  }, []);

  const beginCountdown = useCallback(() => {
    if (countdownStartedRef.current) return;
    countdownStartedRef.current = true;
    clearAllCountdownTimers();
    soundEngine.stopBackgroundMusic();

    setPhase('COUNTDOWN');
    setCountdown(3);
    soundEngine.playCountdownBeep(3);
    void soundEngine.speakHebrew('שלוש', { rate: 0.95, pitch: 0.78, volume: 1.0 });

    const t2 = window.setTimeout(() => {
      setCountdown(2);
      soundEngine.playCountdownBeep(2);
      void soundEngine.speakHebrew('שתיים', { rate: 0.95, pitch: 0.78, volume: 1.0 });
    }, 950);

    const t1 = window.setTimeout(() => {
      setCountdown(1);
      soundEngine.playCountdownBeep(1);
      void soundEngine.speakHebrew('אחת', { rate: 0.95, pitch: 0.78, volume: 1.0 });
    }, 1900);

    const tGo = window.setTimeout(() => {
      setCountdown('GO');
      soundEngine.playGoFanfare();
      void soundEngine.speakHebrew('צא לדרך!', { rate: 0.95, pitch: 0.82, volume: 1.0 });
    }, 2850);

    const tStart = window.setTimeout(() => {
      setPhase('ACTIVE');
      gameStartTimeRef.current = performance.now();
      gameplayActiveRef.current = true;
    }, 3650);

    countdownTimersRef.current = [t2, t1, tGo, tStart];
  }, [clearAllCountdownTimers]);

  // Phase A: Authoritative Browser Voice Narration -> waits for onended -> Phase B: Countdown ('3, 2, 1, צא לדרך!')
  useEffect(() => {
    gameplayActiveRef.current = false;
    countdownStartedRef.current = false;
    setPhase('BRIEFING');
    setTimeLeft(duration);

    return () => {
      clearAllCountdownTimers();
      soundEngine.stopSpeech();
    };
  }, [mode, duration, clearAllCountdownTimers]);

  // Main 60fps Canvas & Motion/Hand Tracking Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motion = motionRef.current ?? new MotionDetector();
    motionRef.current = motion;
    motion.setSensitivity(sensitivity);
    motion.reset();

    const handTracker = handTrackerRef.current;
    handTracker.initialize();

    const initialScores: PlayerScores =
      mode === 'duel' ? { left: 100, right: 100 } : { left: 0, right: 0 };
    scoresRef.current = { ...initialScores };
    endedRef.current = false;
    setScores({ ...initialScores });
    setTimeLeft(duration);

    const sufganiyot = new SufganiyotGame();
    const hanukkiah = new HanukkiahGame();
    const dreidel = new DreidelGame();
    const maccabees = new MaccabeesGame();
    const coins = new CoinsGame();
    const sugarwar = new SugarWarGame();
    const simon = new SimonGame();
    const sword = new SwordGame();
    const duel = new DuelGame();

    sufganiyot.reset();
    hanukkiah.reset();
    dreidel.reset();
    maccabees.reset();
    coins.reset();
    sugarwar.reset();
    simon.reset();
    sword.reset();
    duel.reset();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let lastFrameTime = performance.now();
    let lastWholeSecond: number = duration;
    let rafId = 0;

    const loop = (now: number) => {
      if (endedRef.current) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
      lastFrameTime = now;

      const w = canvas.width;
      const h = canvas.height;
      const video = videoRef.current;
      if (video && video.paused && video.srcObject) {
        video.play().catch(() => {});
      }

      if (MEDIAPIPE_CAMERA_MODES.has(mode)) {
        handTracker.update(video, w, h, dt);
        motion.setTrackedFingers(handTracker.getFingers());
      } else {
        motion.setTrackedFingers([]);
      }
      motion.update(video, w, h);

      // Keep canvas strictly transparent so mirrored 0.65-opacity webcam <video> remains clearly visible behind it
      ctx.clearRect(0, 0, w, h);
      motion.drawMotionFeedback(ctx, w, h);

      if (gameplayActiveRef.current) {
        const elapsedSec = (now - gameStartTimeRef.current) / 1000;
        const remaining = Math.max(0, duration - elapsedSec);
        const ceilSec = Math.ceil(remaining);

        if (ceilSec !== lastWholeSecond) {
          lastWholeSecond = ceilSec;
          setTimeLeft(ceilSec);
          if (ceilSec > 0 && ceilSec <= 5) {
            soundEngine.playCountdownTick(ceilSec <= 3);
          }
        }

        if (remaining <= 0) {
          endedRef.current = true;
          soundEngine.playEndWhistle();
          onGameEnd({ ...scoresRef.current });
          return;
        }

        let changed = false;
        ctx.save();
        if (mode === 'sufganiyot') {
          changed = sufganiyot.update(dt, w, h, motion, scoresRef.current);
          sufganiyot.draw(ctx, w, h);
        } else if (mode === 'hanukkiah') {
          changed = hanukkiah.update(dt, w, h, motion, scoresRef.current);
          hanukkiah.draw(ctx, w, h);
        } else if (mode === 'dreidel') {
          changed = dreidel.update(dt, w, h, motion, scoresRef.current);
          dreidel.draw(ctx, w, h);
        } else if (mode === 'maccabees') {
          changed = maccabees.update(dt, w, h, motion, scoresRef.current);
          maccabees.draw(ctx, w, h);
        } else if (mode === 'coins') {
          changed = coins.update(dt, w, h, motion, scoresRef.current);
          coins.draw(ctx, w, h);
        } else if (mode === 'sugarwar') {
          changed = sugarwar.update(dt, w, h, motion, scoresRef.current);
          sugarwar.draw(ctx, w, h);
        } else if (mode === 'sword') {
          changed = sword.update(dt, w, h, motion, scoresRef.current);
          sword.draw(ctx, w, h);
        } else if (mode === 'duel') {
          changed = duel.update(dt, w, h, motion, scoresRef.current);
          duel.draw(ctx, w, h);
          if (duel.isKnockout()) {
            ctx.restore();
            setScores({ ...scoresRef.current });
            endedRef.current = true;
            soundEngine.playKnockoutBell();
            onGameEnd({ ...scoresRef.current });
            return;
          }
        } else {
          changed = simon.update(dt, w, h, motion, scoresRef.current);
          simon.draw(ctx, w, h);
        }
        ctx.restore();

        if (changed) {
          setScores({ ...scoresRef.current });
        }
      }

      handTracker.drawFingerOrbs(ctx, w, h);

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [mode, duration, sensitivity, videoRef, handTrackerRef, onGameEnd]);

  const handlePointerInput = (clientX: number, clientY: number, strength: number) => {
    if (!motionRef.current) return;
    const normX = clientX / Math.max(1, window.innerWidth);
    const normY = clientY / Math.max(1, window.innerHeight);
    motionRef.current.addPointerImpulse(normX, normY, strength);
  };

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div
      dir="ltr"
      className="fixed inset-0 z-20 h-[100dvh] max-h-[100dvh] overflow-hidden select-none touch-none"
      onPointerMove={(e) => handlePointerInput(e.clientX, e.clientY, 0.9)}
      onPointerDown={(e) => handlePointerInput(e.clientX, e.clientY, 1.0)}
    >
      {/* Thick, bright glowing gold vertical center divider separating Left and Right players */}
      <div
        aria-hidden="true"
        style={{ boxShadow: '0 0 15px rgba(255, 215, 0, 0.9)' }}
        className="pointer-events-none fixed top-0 bottom-0 left-1/2 -translate-x-1/2 w-[7px] bg-gradient-to-b from-[#FFE55C] via-[#FFD700] to-[#F59E0B] z-20"
      />

      {/* Interactive 2D Game Canvas */}
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full z-10" />

      {/* Phase A: Exact 7-Second Animated Tutorial + Authoritative Narration */}
      {phase === 'BRIEFING' && (
        <GameBriefingTutorial
          mode={mode}
          onComplete={beginCountdown}
          onSkip={() => {
            soundEngine.stopSpeech();
            beginCountdown();
          }}
        />
      )}

      {/* Phase B: Dramatic Voice Countdown ('3... 2... 1... צא לדרך!') */}
      {phase === 'COUNTDOWN' && (
        <div
          dir="rtl"
          className="fixed inset-0 z-40 pointer-events-none flex flex-col items-center justify-center bg-slate-950/35 backdrop-blur-[2px]"
        >
          <div key={String(countdown)} className="animate-countdown-pop text-center px-6">
            {countdown === 'GO' ? (
              <span className="font-display text-6xl sm:text-8xl md:text-9xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-emerald-200 via-amber-300 to-orange-400 drop-shadow-[0_10px_35px_rgba(251,191,36,0.85)]">
                צא לדרך!
              </span>
            ) : (
              <span className="font-display text-[9rem] sm:text-[12rem] md:text-[15rem] leading-none font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-amber-100 via-amber-400 to-orange-500 drop-shadow-[0_12px_40px_rgba(251,191,36,0.85)] tabular-nums">
                {countdown}
              </span>
            )}
          </div>
          <p className="mt-4 text-xl sm:text-2xl font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
            {countdown === 'GO' ? 'האתגר מתחיל!' : 'היכונו מול המצלמה...'}
          </p>
        </div>
      )}

      {/* Top Shared HUD pinned at top: 8px, ~35% smaller, semi-transparent rgba(0,0,0,0.45) */}
      <div className="fixed top-[8px] inset-x-0 z-30 pointer-events-none px-2 sm:px-4 flex items-start justify-between gap-1.5 sm:gap-2">
        {/* Left Player Score / Health Bar */}
        {mode === 'duel' ? (
          <div
            dir="rtl"
            className={`flex flex-col items-stretch bg-[rgba(0,0,0,0.45)] backdrop-blur-sm border rounded-xl px-2 py-1 sm:px-3 sm:py-1.5 shadow-lg min-w-0 flex-1 max-w-[104px] sm:max-w-[190px] md:max-w-[215px] ${
              scores.left <= 25
                ? 'border-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.45)] animate-pulse'
                : 'border-sky-400/75'
            }`}
          >
            <div className="flex items-center justify-between gap-1 sm:gap-2 mb-0.5 sm:mb-1">
              <span className="text-[10px] sm:text-xs font-extrabold text-sky-300 truncate">שחקן שמאל</span>
              <span className="font-display text-base sm:text-2xl font-extrabold text-white tabular-nums leading-none">
                {scores.left}%
              </span>
            </div>
            <div className="w-full h-2.5 sm:h-4 rounded-full bg-slate-900/70 border border-white/20 overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-150 ${
                  scores.left > 55
                    ? 'bg-gradient-to-l from-emerald-400 to-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]'
                    : scores.left > 25
                    ? 'bg-gradient-to-l from-amber-300 to-yellow-500 shadow-[0_0_10px_rgba(250,204,21,0.7)]'
                    : 'bg-gradient-to-l from-rose-500 to-red-600 shadow-[0_0_12px_rgba(239,68,68,0.85)]'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, scores.left))}%` }}
              />
            </div>
          </div>
        ) : (
          <div
            dir="rtl"
            className="flex flex-col items-center bg-[rgba(0,0,0,0.45)] backdrop-blur-sm border border-sky-400/65 rounded-xl px-2 py-1 sm:px-3.5 sm:py-1.5 shadow-lg min-w-[66px] sm:min-w-[114px]"
          >
            <span className="text-[10px] sm:text-xs font-bold text-sky-300 leading-tight">שחקן שמאל</span>
            <div className="flex items-baseline gap-1 sm:gap-1.5">
              <span className="font-display text-xl sm:text-3xl font-extrabold text-white tabular-nums leading-tight">
                {scores.left}
              </span>
              <span className="text-[9px] sm:text-[11px] font-semibold text-sky-200">{SCORE_UNITS[mode]}</span>
            </div>
          </div>
        )}

        {/* Top Center Countdown Timer & Compact Controls */}
        <div className="flex flex-col items-center gap-1 pointer-events-auto shrink-0">
          <div
            dir="rtl"
            className={`flex flex-col items-center px-2.5 py-1 sm:px-4 sm:py-1.5 rounded-xl backdrop-blur-sm border shadow-lg transition-colors ${
              timeLeft <= 10
                ? 'bg-rose-950/75 border-rose-400 text-rose-100 animate-pulse'
                : 'bg-[rgba(0,0,0,0.45)] border-amber-400/70 text-amber-100'
            }`}
          >
            <span className="text-[9px] sm:text-[11px] font-bold text-amber-300 whitespace-nowrap max-w-[100px] sm:max-w-none truncate leading-tight">
              {GAME_TITLES[mode]}
            </span>
            <span className="font-display text-xl sm:text-3xl font-extrabold tabular-nums tracking-wider leading-none mt-0.5">
              {formatTime(timeLeft)}
            </span>
          </div>

          <div dir="rtl" className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
            {cameraState.status !== 'active' && (
              <button
                type="button"
                onClick={onRequestCamera}
                className="flex items-center gap-1 px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 text-[10px] sm:text-xs font-extrabold shadow-md transition-all cursor-pointer whitespace-nowrap"
              >
                <Camera className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>הפעל מצלמה</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                clearAllCountdownTimers();
                soundEngine.stopSpeech();
                soundEngine.stopBackgroundMusic();
                onExitToMenu();
              }}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-[rgba(0,0,0,0.45)] hover:bg-slate-800/80 border border-white/20 text-[10px] sm:text-xs font-bold text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>תפריט ראשי</span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'הפעל צלילים' : 'השתק צלילים'}
              className="p-1 rounded-lg bg-[rgba(0,0,0,0.45)] hover:bg-slate-800/80 border border-white/20 text-amber-200 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {(cameraState.status === 'denied' || cameraState.status === 'unavailable') && (
            <div
              dir="rtl"
              role="alert"
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-rose-950/85 border border-rose-400/80 text-rose-100 text-[10px] sm:text-xs font-semibold shadow-md max-w-[220px] sm:max-w-md text-center"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              <span>
                {cameraState.status === 'denied'
                  ? 'המצלמה חסומה בדפדפן — אשרו גישה ולחצו "הפעל מצלמה" (עכבר/מגע פעילים)'
                  : 'מצלמה לא זמינה — ניתן לשחק באמצעות העכבר או מגע'}
              </span>
            </div>
          )}
        </div>

        {/* Right Player Score / Health Bar */}
        {mode === 'duel' ? (
          <div
            dir="rtl"
            className={`flex flex-col items-stretch bg-[rgba(0,0,0,0.45)] backdrop-blur-sm border rounded-xl px-2 py-1 sm:px-3 sm:py-1.5 shadow-lg min-w-0 flex-1 max-w-[104px] sm:max-w-[190px] md:max-w-[215px] ${
              scores.right <= 25
                ? 'border-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.45)] animate-pulse'
                : 'border-amber-400/75'
            }`}
          >
            <div className="flex items-center justify-between gap-1 sm:gap-2 mb-0.5 sm:mb-1">
              <span className="text-[10px] sm:text-xs font-extrabold text-amber-300 truncate">שחקן ימין</span>
              <span className="font-display text-base sm:text-2xl font-extrabold text-white tabular-nums leading-none">
                {scores.right}%
              </span>
            </div>
            <div className="w-full h-2.5 sm:h-4 rounded-full bg-slate-900/70 border border-white/20 overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-150 ${
                  scores.right > 55
                    ? 'bg-gradient-to-l from-emerald-400 to-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]'
                    : scores.right > 25
                    ? 'bg-gradient-to-l from-amber-300 to-yellow-500 shadow-[0_0_10px_rgba(250,204,21,0.7)]'
                    : 'bg-gradient-to-l from-rose-500 to-red-600 shadow-[0_0_12px_rgba(239,68,68,0.85)]'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, scores.right))}%` }}
              />
            </div>
          </div>
        ) : (
          <div
            dir="rtl"
            className="flex flex-col items-center bg-[rgba(0,0,0,0.45)] backdrop-blur-sm border border-amber-400/65 rounded-xl px-2 py-1 sm:px-3.5 sm:py-1.5 shadow-lg min-w-[66px] sm:min-w-[114px]"
          >
            <span className="text-[10px] sm:text-xs font-bold text-amber-300 leading-tight">שחקן ימין</span>
            <div className="flex items-baseline gap-1 sm:gap-1.5">
              <span className="font-display text-xl sm:text-3xl font-extrabold text-white tabular-nums leading-tight">
                {scores.right}
              </span>
              <span className="text-[9px] sm:text-[11px] font-semibold text-amber-200">{SCORE_UNITS[mode]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
