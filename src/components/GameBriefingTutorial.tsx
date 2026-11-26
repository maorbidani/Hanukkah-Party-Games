import React, { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { GameMode } from '../types/game';

interface GameBriefingTutorialProps {
  mode: GameMode;
  onComplete: () => void;
  onSkip: () => void;
}

export const BRIEFING_SCRIPTS: Record<
  GameMode,
  {
    title: string;
    speech: string;
    display: string;
    gradient: string;
  }
> = {
  sufganiyot: {
    title: 'משימת הסופגניות! 🍩',
    speech:
      'הניפו ידיים באוויר ותפסו כמה שיותר סופגניות! היזהרו לא לגעת בפצצות! מוכנים?',
    display: 'הניפו ידיים באוויר ותפסו סופגניות מתוקות — היזהרו מהפצצות שמורידות נקודות!',
    gradient: 'from-rose-600/95 via-amber-600/95 to-orange-600/95',
  },
  hanukkiah: {
    title: 'משימת החנוכיות! 🕎',
    speech:
      'געו קודם בנר השמש הזוהר שבפינה, והעבירו אותו מעל כל הנרות כדי להדליק את החנוכייה! מוכנים?',
    display: 'געו קודם בנר השמש הזוהר שבפינה, והעבירו אותו באוויר מעל כל 8 הנרות!',
    gradient: 'from-sky-600/95 via-blue-700/95 to-indigo-700/95',
  },
  dreidel: {
    title: 'מרוץ הסביבונים! 🌀',
    speech:
      'נופפו בידיים הכי מהר שאפשר כדי לסובב את הסביבון ולשבור שיאים! מוכנים?',
    display: 'נופפו בידיים הכי מהר שאפשר כדי להאיץ את הסביבון ולשבור שיא סיבובים!',
    gradient: 'from-emerald-600/95 via-teal-600/95 to-cyan-700/95',
  },
  maccabees: {
    title: 'מגן המכבים! 🛡️',
    speech:
      'הזיזו את המגן שעל היד שלכם וחסמו את כל החיצים וכדורי האש שנופלים מלמעלה! מוכנים?',
    display: 'הזיזו את המגן הזוהר שעל היד וחסמו כל חץ וכדור אש שיורדים מלמעלה!',
    gradient: 'from-violet-600/95 via-purple-700/95 to-indigo-800/95',
  },
  coins: {
    title: 'שודדי המטבעות! 🪙',
    speech:
      'אספו באוויר כמה שיותר מטבעות שוקולד ושקיות זהב, והתרחקו מהפחמים השחורים! מוכנים?',
    display: 'אספו מטבעות זהב (+1) ושקיות נוצצות (+5) — והתרחקו מהפחמים השחורים (-2)!',
    gradient: 'from-amber-500/95 via-yellow-600/95 to-orange-600/95',
  },
  sugarwar: {
    title: 'מלחמת אבקת סוכר! ❄️',
    speech:
      'תפסו כדורי סוכר בצד שלכם והעיפו אותם לעבר היריב כדי להסתיר לו את המסך! מוכנים?',
    display: 'תפסו כדורי סוכר בצד שלכם והעיפו אותם לצד היריב כדי לכסות לו את המסך!',
    gradient: 'from-cyan-600/95 via-sky-600/95 to-blue-700/95',
  },
  simon: {
    title: 'זיכרון אורות! 💡',
    speech:
      'עקבו אחרי סדר הלפידים שנדלקים, וגעו בהם באוויר בדיוק באותו הסדר! מוכנים?',
    display: 'עקבו היטב אחרי סדר הלפידים שנדלקים, וגעו בהם באוויר בדיוק באותו הסדר!',
    gradient: 'from-pink-600/95 via-fuchsia-700/95 to-purple-800/95',
  },
  sword: {
    title: 'חרב המכבים! ⚔️',
    speech:
      'הצבא היווני מסתער מלמעלה! הניפו את החרב שביידכם וחסלו כמה שיותר לוחמים לפני שיגיעו למטה! מוכנים?',
    display: 'הצבא היווני מסתער מלמעלה! הניפו את החרב הזוהרת וחסלו כמה שיותר לוחמים לפני שיגיעו למטה!',
    gradient: 'from-indigo-600/95 via-blue-700/95 to-amber-600/95',
  },
  duel: {
    title: 'דו-קרב האלופים! 🥊',
    speech:
      'קרב ראש בראש! נופפו בידיים מהר כדי לשגר מכות ברק אל היריב! הראשון שמוריד ליריב את מד החיים לאפס אחוזים — מנצח! מוכנים?',
    display: 'נופפו בידיים מהר ושגרו מכות ברק אל היריב! הראשון שמוריד ליריב את מד החיים ל-0% — מנצח!',
    gradient: 'from-rose-600/95 via-red-700/95 to-amber-600/95',
  },
};

const BRIEFING_DURATION_MS = 10000;
const MAX_WITH_SPEECH_MS = 16000;

function drawVirtualHand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  glowColor: string = 'rgba(250, 204, 21, 0.7)'
) {
  ctx.save();
  ctx.translate(x, y);

  // Magic aura around palm
  const aura = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
  aura.addColorStop(0, '#FFFFFF');
  aura.addColorStop(0.35, glowColor);
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();

  // Stylized cartoon glove/hand icon
  ctx.fillStyle = '#FEF9C3';
  ctx.strokeStyle = '#92400E';
  ctx.lineWidth = 2.5;

  // Fingers
  const fingers = [
    { dx: -11, h: 16, angle: -0.22 },
    { dx: -4, h: 21, angle: -0.06 },
    { dx: 4, h: 22, angle: 0.05 },
    { dx: 11, h: 17, angle: 0.2 },
  ];
  for (const f of fingers) {
    ctx.save();
    ctx.translate(f.dx, -4);
    ctx.rotate(f.angle);
    ctx.beginPath();
    ctx.roundRect(-3.5, -f.h, 7, f.h + 4, 3.5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Thumb
  ctx.save();
  ctx.translate(-14, 6);
  ctx.rotate(-0.75);
  ctx.beginPath();
  ctx.roundRect(-3.5, -13, 7, 15, 3.5);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Palm
  ctx.beginPath();
  ctx.roundRect(-14, -4, 28, 22, 9);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

export const GameBriefingTutorial: React.FC<GameBriefingTutorialProps> = ({
  mode,
  onComplete,
  onSkip,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [replayNonce, setReplayNonce] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(() => soundEngine.isSpeaking());
  const [readyToStart, setReadyToStart] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const [progressPct, setProgressPct] = useState<number>(0);
  const completedRef = useRef<boolean>(false);

  const info = BRIEFING_SCRIPTS[mode];

  // Guarantee a full 10-second briefing window (plus wait for speech onended if still speaking, capped at 13.5s)
  useEffect(() => {
    completedRef.current = false;
    setReadyToStart(false);
    setSecondsLeft(10);
    setProgressPct(0);

    let speechDone = !soundEngine.isSpeaking();
    setIsSpeaking(!speechDone);

    const startTime = performance.now();
    let tickInterval: number | null = null;
    let safetyTimer: number | null = null;

    const triggerComplete = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      if (tickInterval !== null) window.clearInterval(tickInterval);
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      onComplete();
    };

    const evaluateCompletion = () => {
      const elapsed = performance.now() - startTime;
      const pct = Math.min(100, (elapsed / BRIEFING_DURATION_MS) * 100);
      const sec = Math.max(0, Math.ceil((BRIEFING_DURATION_MS - elapsed) / 1000));
      setProgressPct(pct);
      setSecondsLeft(sec);

      if (elapsed >= BRIEFING_DURATION_MS && speechDone) {
        triggerComplete();
      }
    };

    tickInterval = window.setInterval(evaluateCompletion, 100);

    safetyTimer = window.setTimeout(() => {
      soundEngine.stopSpeech();
      triggerComplete();
    }, MAX_WITH_SPEECH_MS);

    const unsubSpeech = soundEngine.onCurrentSpeechEnd(() => {
      if (completedRef.current) return;
      speechDone = true;
      setIsSpeaking(false);
      setReadyToStart(true);
      evaluateCompletion();
    });

    return () => {
      unsubSpeech();
      if (tickInterval !== null) window.clearInterval(tickInterval);
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
    };
  }, [mode, replayNonce, onComplete]);

  const handleReplay = () => {
    soundEngine.unlock();
    soundEngine.startBackgroundMusic();
    setReadyToStart(false);
    setIsSpeaking(true);
    void soundEngine.speakHebrew(info.speech, {
      duckLevel: 0.15,
      rate: 0.95,
      pitch: 0.85,
      volume: 1.0,
    });
    setReplayNonce((n) => n + 1);
  };

  // Live 60fps Canvas Demonstration Animation tailored to each of the 9 games
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 460;
    const H = 200;
    canvas.width = W;
    canvas.height = H;

    const start = performance.now();
    let rafId = 0;

    const render = (now: number) => {
      const t = (now - start) / 1000; // elapsed seconds (0..7)
      ctx.clearRect(0, 0, W, H);

      // Subtle arena frame background
      ctx.fillStyle = 'rgba(9, 18, 44, 0.55)';
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, 18);
      ctx.fill();

      if (mode === 'sufganiyot') {
        const cycle = t % 3.5; // 3.5s loop
        const donutHit = cycle > 1.35;
        const donutX = 145;
        const donutY = cycle < 1.35 ? 180 - Math.sin((cycle / 1.35) * Math.PI * 0.55) * 95 : 85;
        const bombX = 325;
        const bombY = 175 - Math.sin(((cycle % 3.5) / 3.5) * Math.PI) * 95;

        // Bomb on right
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.arc(bombX, bombY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FB7185';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bombX - 9, bombY - 9);
        ctx.lineTo(bombX + 9, bombY + 9);
        ctx.moveTo(bombX + 9, bombY - 9);
        ctx.lineTo(bombX - 9, bombY + 9);
        ctx.stroke();

        // Donut or powdered sugar burst
        if (!donutHit) {
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.ellipse(donutX, donutY, 28, 22, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFDF7';
          ctx.beginPath();
          ctx.ellipse(donutX, donutY - 4, 20, 12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E11D48';
          ctx.beginPath();
          ctx.arc(donutX, donutY - 5, 7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const burstP = (cycle - 1.35) / 1.2;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const d = burstP * 45;
            ctx.fillStyle = i % 3 === 0 ? '#E11D48' : '#FFFFFF';
            ctx.globalAlpha = Math.max(0, 1 - burstP);
            ctx.beginPath();
            ctx.arc(donutX + Math.cos(a) * d, donutY + Math.sin(a) * d, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = Math.max(0, 1 - burstP);
          ctx.font = '800 24px Fredoka, sans-serif';
          ctx.fillStyle = '#4ADE80';
          ctx.textAlign = 'center';
          ctx.fillText('+1', donutX, donutY - 18 - burstP * 20);
          ctx.globalAlpha = 1;
        }

        // Virtual hand moves to donut, then pulls away from bomb
        const hx = cycle < 1.35 ? 230 - (cycle / 1.35) * 85 : cycle < 2.2 ? 145 : 145 - (cycle - 2.2) * 35;
        const hy = cycle < 1.35 ? 150 - (cycle / 1.35) * 65 : 85;
        drawVirtualHand(ctx, hx, hy);
      } else if (mode === 'hanukkiah') {
        const cycle = t % 5.0;
        const grabbed = cycle > 1.2;
        const litCount = grabbed ? Math.min(8, Math.floor(((cycle - 1.2) / 3.2) * 8.5)) : 0;

        // Draw Hanukkiah
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(185, 175);
        ctx.lineTo(295, 175);
        ctx.moveTo(240, 175);
        ctx.lineTo(240, 125);
        ctx.stroke();

        for (let i = 0; i < 8; i++) {
          const cx = 135 + i * 30;
          ctx.fillStyle = '#E0F2FE';
          ctx.fillRect(cx - 5, 102, 10, 32);
          if (i < litCount) {
            ctx.fillStyle = '#F97316';
            ctx.beginPath();
            ctx.arc(cx, 94, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FEF08A';
            ctx.beginPath();
            ctx.arc(cx, 95, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Corner Shamash or Held Shamash
        let sx = 65;
        let sy = 50;
        let hx = 120;
        let hy = 130;

        if (!grabbed) {
          const p = cycle / 1.2;
          hx = 120 + (65 - 120) * p;
          hy = 130 + (50 - 130) * p;
        } else {
          const sweepP = Math.min(1, (cycle - 1.2) / 3.2);
          hx = 135 + sweepP * 215;
          hy = 90 + Math.sin(sweepP * Math.PI * 4) * 6;
          sx = hx;
          sy = hy - 14;
        }

        if (!grabbed) {
          ctx.strokeStyle = '#FDE047';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 24, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        drawVirtualHand(ctx, hx, hy);

        // Draw Shamash candle
        ctx.fillStyle = '#FACC15';
        ctx.fillRect(sx - 5, sy - 10, 10, 26);
        ctx.fillStyle = '#F97316';
        ctx.beginPath();
        ctx.arc(sx, sy - 16, 7, 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === 'dreidel') {
        const speed = 4 + Math.min(26, t * 4.5);
        const angle = t * speed;
        const cx = 230;
        const cy = 104;

        // Speed ring
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, 56, 0, Math.min(Math.PI * 2, (t / 6) * Math.PI * 2));
        ctx.stroke();

        // Spinning Dreidel
        const wFactor = Math.max(0.25, Math.abs(Math.cos(angle)));
        ctx.fillStyle = '#FACC15';
        ctx.fillRect(cx - 5, cy - 42, 10, 14);
        ctx.fillStyle = '#0284C7';
        ctx.strokeStyle = '#FDE047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.rect(cx - 24 * wFactor, cy - 28, 48 * wFactor, 40);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.moveTo(cx - 24 * wFactor, cy + 12);
        ctx.lineTo(cx + 24 * wFactor, cy + 12);
        ctx.lineTo(cx, cy + 38);
        ctx.closePath();
        ctx.fill();

        // Rapidly waving hands on left & right
        const wave = Math.sin(t * 14) * 32;
        drawVirtualHand(ctx, 95 + wave, 110, 'rgba(56, 189, 248, 0.85)');
        drawVirtualHand(ctx, 365 - wave, 110, 'rgba(251, 191, 36, 0.85)');
      } else if (mode === 'maccabees') {
        const cycle = t % 2.4;
        const arrowX = 230 + Math.sin(t * 1.5) * 85;
        const arrowY = cycle < 1.3 ? 15 + (cycle / 1.3) * 105 : 120;
        const handX = arrowX;
        const handY = 132;

        drawVirtualHand(ctx, handX, handY);

        // Glowing Shield on palm
        ctx.fillStyle = '#1D4ED8';
        ctx.strokeStyle = '#FDE047';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(handX, handY, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (cycle < 1.3) {
          // Falling arrow
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY - 26);
          ctx.lineTo(arrowX, arrowY);
          ctx.stroke();
          ctx.fillStyle = '#E2E8F0';
          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY + 8);
          ctx.lineTo(arrowX - 7, arrowY - 4);
          ctx.lineTo(arrowX + 7, arrowY - 4);
          ctx.closePath();
          ctx.fill();
        } else {
          // Metallic spark explosion
          const p = (cycle - 1.3) / 0.8;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            ctx.fillStyle = i % 2 === 0 ? '#FACC15' : '#FFFFFF';
            ctx.globalAlpha = Math.max(0, 1 - p);
            ctx.beginPath();
            ctx.arc(handX + Math.cos(a) * p * 44, handY - 18 + Math.sin(a) * p * 35, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.font = '800 22px Fredoka, sans-serif';
          ctx.fillStyle = '#4ADE80';
          ctx.textAlign = 'center';
          ctx.fillText('+1', handX, handY - 38);
        }
      } else if (mode === 'coins') {
        const cycle = t % 2.8;
        const coinX = 165;
        const coinY = cycle < 1.3 ? 15 + (cycle / 1.3) * 95 : 110;
        const coalX = 320;
        const coalY = 25 + ((t * 55) % 150);

        // Black coal to avoid
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.arc(coalX, coalY, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FB7185';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(coalX - 7, coalY - 7);
        ctx.lineTo(coalX + 7, coalY + 7);
        ctx.moveTo(coalX + 7, coalY - 7);
        ctx.lineTo(coalX - 7, coalY + 7);
        ctx.stroke();

        // Gold pouch / coin
        if (cycle < 1.3) {
          ctx.fillStyle = '#FACC15';
          ctx.beginPath();
          ctx.arc(coinX, coinY, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#78350F';
          ctx.font = '800 16px Fredoka, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+5', coinX, coinY + 5);
        } else {
          ctx.font = '800 26px Fredoka, sans-serif';
          ctx.fillStyle = '#FDE047';
          ctx.textAlign = 'center';
          ctx.fillText('+5!', coinX, coinY - 12);
        }

        const hx = cycle < 1.3 ? 120 + (cycle / 1.3) * 45 : 165;
        drawVirtualHand(ctx, hx, 114);
      } else if (mode === 'sugarwar') {
        const cycle = t % 3.0;
        // Center divider
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(230, 12);
        ctx.lineTo(230, 188);
        ctx.stroke();

        const hx = cycle < 0.9 ? 70 + (cycle / 0.9) * 55 : 125;
        drawVirtualHand(ctx, hx, 110);

        if (cycle < 0.9) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(125, 110, 18, 0, Math.PI * 2);
          ctx.fill();
        } else if (cycle < 1.8) {
          const p = (cycle - 0.9) / 0.9;
          const bx = 125 + p * 220;
          const by = 110 - Math.sin(p * Math.PI) * 40;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(bx, by, 16, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Big white powdered sugar splat on opponent side
          ctx.fillStyle = '#FFFDF9';
          ctx.beginPath();
          ctx.arc(345, 102, 36, 0, Math.PI * 2);
          ctx.arc(372, 84, 20, 0, Math.PI * 2);
          ctx.arc(320, 124, 18, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (mode === 'sword') {
        const cycle = t % 3.2;
        const soldierHit = cycle > 1.5;

        // Squad of 3 Greek soldiers charging from top to bottom
        const squad = [
          { x: 145, baseTop: 18, speed: 52, isTarget: false },
          { x: 235, baseTop: 8, speed: 58, isTarget: true },
          { x: 335, baseTop: 26, speed: 48, isTarget: false },
        ];

        for (const member of squad) {
          const sy = Math.min(165, member.baseTop + cycle * member.speed);
          if (member.isTarget && soldierHit) {
            const p = (cycle - 1.5) / 1.3;
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - p);
            ctx.translate(member.x - p * 35, sy - 10 - Math.sin(p * Math.PI) * 30);
            ctx.rotate(-p * 3.5);
            ctx.fillStyle = '#D97706';
            ctx.beginPath();
            ctx.arc(0, 0, 11, Math.PI, 0);
            ctx.fill();
            ctx.restore();

            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              ctx.fillStyle = i % 2 === 0 ? '#FACC15' : '#38BDF8';
              ctx.globalAlpha = Math.max(0, 1 - p);
              ctx.beginPath();
              ctx.arc(member.x + Math.cos(a) * p * 44, sy + Math.sin(a) * p * 38, 4, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = Math.max(0, 1 - p);
            ctx.font = '800 24px Fredoka, sans-serif';
            ctx.fillStyle = '#4ADE80';
            ctx.textAlign = 'center';
            ctx.fillText('+1', member.x, sy - 20 - p * 16);
            ctx.globalAlpha = 1;
            continue;
          }

          // Running legs + helmet + shield + spear
          const stride = Math.sin(t * 14 + member.x) * 6;
          ctx.save();
          ctx.translate(member.x, sy);
          ctx.strokeStyle = '#FDBA74';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-6, 15);
          ctx.lineTo(-7, 25 + stride);
          ctx.moveTo(6, 15);
          ctx.lineTo(7, 25 - stride);
          ctx.stroke();

          // Spear pointing down
          ctx.save();
          ctx.translate(14, 4);
          ctx.rotate(0.2);
          ctx.strokeStyle = '#92400E';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, -18);
          ctx.lineTo(0, 22);
          ctx.stroke();
          ctx.fillStyle = '#E2E8F0';
          ctx.beginPath();
          ctx.moveTo(0, 28);
          ctx.lineTo(-4, 20);
          ctx.lineTo(4, 20);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Shield & body
          ctx.fillStyle = '#991B1B';
          ctx.beginPath();
          ctx.roundRect(-11, -3, 22, 22, 5);
          ctx.fill();
          ctx.fillStyle = '#B45309';
          ctx.strokeStyle = '#FDE047';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(-11, 8, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Face + Helmet
          ctx.fillStyle = '#FDBA74';
          ctx.beginPath();
          ctx.arc(0, -10, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E11D48';
          ctx.beginPath();
          ctx.arc(0, -23, 9, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = '#D97706';
          ctx.beginPath();
          ctx.arc(0, -13, 11.5, Math.PI, 0);
          ctx.fill();
          ctx.restore();
        }

        // Hand gripping glowing Maccabee sword slashing center charging soldier
        const slashP = cycle < 1.05 ? 0 : Math.min(1, (cycle - 1.05) / 0.55);
        const hx = 165 + slashP * 125;
        const hy = 132 - Math.sin(slashP * Math.PI) * 32;
        const swordAngle = -0.95 + slashP * 1.55;

        if (slashP > 0.05 && slashP < 0.98) {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
          ctx.lineWidth = 10;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(hx - 12, hy + 10, 58, -1.7, -1.7 + slashP * 1.6);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(swordAngle);
        ctx.shadowColor = '#38BDF8';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#E0F2FE';
        ctx.beginPath();
        ctx.moveTo(-4, -8);
        ctx.lineTo(-3, -64);
        ctx.lineTo(0, -76);
        ctx.lineTo(3, -64);
        ctx.lineTo(4, -8);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FACC15';
        ctx.fillRect(-13, -10, 26, 5);
        ctx.restore();

        drawVirtualHand(ctx, hx, hy, 'rgba(56, 189, 248, 0.85)');
      } else if (mode === 'duel') {
        const cycle = t % 4.0;
        const rightHp = Math.max(0, Math.round(100 - (cycle / 4.0) * 100));
        const leftHp = Math.max(36, Math.round(100 - (cycle / 4.0) * 52));

        // Center split divider
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(230, 8);
        ctx.lineTo(230, 192);
        ctx.stroke();

        // Top HP bars (Green -> Yellow -> Red)
        const drawHpBar = (bx: number, pct: number, label: string) => {
          const bw = 165;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.beginPath();
          ctx.roundRect(bx, 16, bw, 18, 8);
          ctx.fill();

          const color = pct > 55 ? '#22C55E' : pct > 25 ? '#FACC15' : '#EF4444';
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(bx + 2, 18, Math.max(0, ((bw - 4) * pct) / 100), 14, 6);
          ctx.fill();

          ctx.font = '800 13px Fredoka, sans-serif';
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.fillText(`${label}: ${pct}%`, bx + bw / 2, 48);
        };

        drawHpBar(28, leftHp, 'שמאל');
        drawHpBar(267, rightHp, 'ימין');

        // Rapidly waving hands on left & right
        const waveL = Math.sin(t * 16) * 24;
        const waveR = Math.cos(t * 15) * 22;
        drawVirtualHand(ctx, 90 + waveL, 128, 'rgba(56, 189, 248, 0.9)');
        drawVirtualHand(ctx, 370 - waveR, 128, 'rgba(251, 146, 60, 0.9)');

        // Flying lightning orbs crossing divider
        const boltP = (t * 1.4) % 1;
        const bx1 = 105 + boltP * 265;
        const by1 = 122 - Math.sin(boltP * Math.PI) * 22;
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(bx1, by1);
        ctx.lineTo(bx1 - 24, by1 + Math.sin(t * 35) * 8);
        ctx.lineTo(bx1 - 44, by1 - Math.sin(t * 35) * 6);
        ctx.stroke();

        ctx.fillStyle = '#FEF9C3';
        ctx.beginPath();
        ctx.arc(bx1, by1, 10, 0, Math.PI * 2);
        ctx.fill();

        if (boltP > 0.85) {
          ctx.font = '800 20px Fredoka, sans-serif';
          ctx.fillStyle = '#FB7185';
          ctx.textAlign = 'center';
          ctx.fillText('-4%', 370, 86);
        }
      } else {
        // Simon Says: 4 colored torches lighting in sequence, then hand touches them
        const colors = ['#EF4444', '#3B82F6', '#22C55E', '#FACC15'];
        const xs = [110, 190, 270, 350];
        const cycle = t % 4.0;
        const seq = [0, 2, 1];

        let activeTorch = -1;
        let hx = 230;
        let hy = 152;

        if (cycle < 1.8) {
          const step = Math.floor(cycle / 0.6);
          activeTorch = seq[step % seq.length];
        } else {
          const inpP = (cycle - 1.8) / 2.0;
          const step = Math.min(2, Math.floor(inpP * 3));
          const targetIdx = seq[step];
          activeTorch = targetIdx;
          hx = xs[targetIdx];
          hy = 96;
        }

        for (let i = 0; i < 4; i++) {
          const lit = activeTorch === i;
          ctx.fillStyle = lit ? colors[i] : 'rgba(15, 23, 42, 0.8)';
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = lit ? 6 : 3;
          ctx.beginPath();
          ctx.arc(xs[i], 86, 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (lit) {
            ctx.fillStyle = '#FEF9C3';
            ctx.beginPath();
            ctx.arc(xs[i], 80, 10, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (cycle >= 1.8) {
          drawVirtualHand(ctx, hx, hy + 18);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-40 h-[100dvh] max-h-[100dvh] overflow-hidden flex items-center justify-center px-3 py-2 sm:px-4 bg-slate-950/60 backdrop-blur-sm"
    >
      <div
        className={`landscape-briefing-card animate-countdown-pop max-w-2xl w-full max-h-[95dvh] overflow-hidden rounded-3xl bg-gradient-to-br ${info.gradient} border-2 border-amber-200/80 p-3.5 sm:p-6 text-center shadow-[0_24px_64px_rgba(0,0,0,0.65)] space-y-2 sm:space-y-3`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs sm:text-base font-extrabold text-amber-100">
            הדרכה לפני שמתחילים ({secondsLeft > 0 ? `${secondsLeft} ש׳` : 'מוכנים!'})
          </span>
          <span className="font-display text-xs sm:text-base font-extrabold text-white bg-slate-950/50 px-3 py-1 rounded-xl border border-white/15">
            {isSpeaking
              ? 'הקריין מסביר... 🎙️'
              : secondsLeft > 0
              ? `מתחילים בעוד ${secondsLeft}...`
              : readyToStart
              ? 'מתחילים מיד! ⚡'
              : 'מתכוננים...'}
          </span>
        </div>

        {/* 10-Second Briefing Progress Bar */}
        <div className="w-full h-2.5 rounded-full bg-slate-950/45 overflow-hidden border border-white/15">
          <div
            className={`h-full transition-all duration-150 ${
              secondsLeft <= 0 && readyToStart
                ? 'bg-emerald-400'
                : 'bg-gradient-to-l from-amber-300 via-yellow-400 to-sky-300'
            }`}
            style={{ width: `${Math.max(4, Math.min(100, progressPct))}%` }}
          />
        </div>

        {/* Live Animated Hand Tutorial Canvas */}
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="landscape-briefing-canvas w-full max-w-[460px] max-h-[22dvh] aspect-[460/200] object-contain rounded-2xl border border-white/20 shadow-inner"
          />
        </div>

        <h2 className="landscape-briefing-title font-display text-xl sm:text-4xl font-extrabold text-white drop-shadow">
          {info.title}
        </h2>
        <p className="landscape-briefing-text text-xs sm:text-xl font-bold text-amber-50 leading-snug sm:leading-relaxed">
          {info.display}
        </p>

        <div className="pt-1 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleReplay}
            className="px-5 py-2 sm:py-2.5 rounded-xl bg-sky-500/30 hover:bg-sky-500/45 border border-sky-200/50 text-white text-sm sm:text-base font-extrabold transition-colors cursor-pointer whitespace-nowrap"
          >
            {isSpeaking ? 'מקריא הוראות... 🔊' : 'שמע שוב 🔊'}
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="px-6 py-2 sm:py-2.5 rounded-xl bg-slate-950/55 hover:bg-slate-950/80 border border-amber-200/40 text-amber-100 text-sm sm:text-base font-extrabold transition-colors cursor-pointer whitespace-nowrap"
          >
            דלג למשחק ⏭️
          </button>
        </div>
      </div>
    </div>
  );
};
