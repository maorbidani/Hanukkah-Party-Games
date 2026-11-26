import React, { useEffect, useState } from 'react';
import { Camera, Sparkles } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { CameraState } from '../types/game';

interface SplashIntroProps {
  onStartParty: () => void;
  onSkipIntro: () => void;
  cameraState: CameraState;
  onRequestCamera: () => void;
  isStartingParty?: boolean;
}

const FestiveHanukkahLogo: React.FC = () => (
  <div className="relative flex items-center justify-center">
    <div
      aria-hidden="true"
      className="absolute w-56 h-56 sm:w-80 sm:h-80 rounded-full bg-amber-400/20 blur-3xl animate-pulse"
    />
    <svg
      viewBox="0 0 360 220"
      className="relative w-40 h-24 sm:w-[320px] sm:h-[185px] lg:w-[350px] lg:h-[200px] drop-shadow-[0_14px_32px_rgba(251,191,36,0.4)]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="logoGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="logoBlue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      {/* Decorative festive stars */}
      <g fill="#FEF08A" opacity="0.85">
        <polygon points="34,42 38,52 48,52 40,58 43,68 34,62 25,68 28,58 20,52 30,52" />
        <polygon points="326,44 329,52 337,52 331,57 333,65 326,60 319,65 321,57 315,52 323,52" />
        <circle cx="95" cy="24" r="3.5" />
        <circle cx="265" cy="24" r="3.5" />
      </g>

      {/* Center Ornate Hanukkiah */}
      <g>
        {/* Base & stem */}
        <path d="M138 198 L222 198 L204 180 L156 180 Z" fill="url(#logoGold)" />
        <rect x="174" y="96" width="12" height="86" rx="4" fill="url(#logoGold)" />
        {/* Curved arms */}
        {[-68, -50, -32, -16, 16, 32, 50, 68].map((dx, i) => (
          <path
            key={i}
            d={`M180 156 Q${180 + dx * 0.55} 160 ${180 + dx} 112`}
            fill="none"
            stroke="url(#logoGold)"
            strokeWidth="6.5"
            strokeLinecap="round"
          />
        ))}
        {/* 8 Candles + Shamash */}
        {[-68, -50, -32, -16, 0, 16, 32, 50, 68].map((dx, idx) => {
          const isShamash = dx === 0;
          const topY = isShamash ? 66 : 84;
          const h = isShamash ? 32 : 28;
          return (
            <g key={idx}>
              <rect
                x={180 + dx - 4.5}
                y={topY}
                width="9"
                height={h}
                rx="2"
                fill={isShamash ? '#FEF08A' : '#E0F2FE'}
              />
              {/* Animated flame */}
              <path
                d={`M${180 + dx} ${topY - 2} Q${180 + dx - 6} ${topY - 12} ${180 + dx} ${
                  topY - 22
                } Q${180 + dx + 6} ${topY - 12} ${180 + dx} ${topY - 2} Z`}
                fill="#F97316"
              >
                <animateTransform
                  attributeName="transform"
                  type="scale"
                  values="1 1;1.06 1.15;0.96 0.95;1 1"
                  dur={`${0.9 + (idx % 3) * 0.25}s`}
                  repeatCount="indefinite"
                  additive="sum"
                />
              </path>
              <path
                d={`M${180 + dx} ${topY - 3} Q${180 + dx - 3} ${topY - 10} ${180 + dx} ${
                  topY - 16
                } Q${180 + dx + 3} ${topY - 10} ${180 + dx} ${topY - 3} Z`}
                fill="#FEF08A"
              />
            </g>
          );
        })}
      </g>

      {/* Left Floating Sufganiyah (Donut) */}
      <g transform="translate(56, 146)">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="56 146;56 136;56 146"
          dur="2.8s"
          repeatCount="indefinite"
        />
        <ellipse cx="0" cy="4" rx="34" ry="26" fill="#B45309" />
        <ellipse cx="0" cy="0" rx="34" ry="25" fill="#F59E0B" />
        <ellipse cx="0" cy="-6" rx="25" ry="15" fill="#FFFDF7" opacity="0.92" />
        <circle cx="0" cy="-7" r="9" fill="#E11D48" />
        <circle cx="-3" cy="-10" r="2.8" fill="#FFFFFF" opacity="0.8" />
      </g>

      {/* Right Floating Spinning Dreidel */}
      <g transform="translate(302, 134)">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="302 134;302 124;302 134"
          dur="2.5s"
          repeatCount="indefinite"
        />
        <rect x="-5" y="-36" width="10" height="16" rx="3" fill="url(#logoGold)" />
        <rect x="-22" y="-20" width="44" height="42" rx="6" fill="url(#logoBlue)" stroke="#FDE047" strokeWidth="3" />
        <polygon points="-22,22 22,22 0,44" fill="url(#logoGold)" />
        <text
          x="0"
          y="7"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="24"
          fontWeight="800"
          fontFamily="Fredoka, Rubik, sans-serif"
        >
          נ
        </text>
      </g>
    </svg>
  </div>
);

export const SplashIntro: React.FC<SplashIntroProps> = ({
  onStartParty,
  onSkipIntro,
  cameraState,
  onRequestCamera,
  isStartingParty = false,
}) => {
  const [testingAudio, setTestingAudio] = useState<boolean>(false);

  const handleTestSpeakers = () => {
    soundEngine.unlock();
    setTestingAudio(true);
    void soundEngine.speakHebrew('המערכת מוכנה!', {
      onEnd: () => setTestingAudio(false),
    });
  };

  return (
    <div className="relative z-20 h-[100dvh] max-h-[100dvh] overflow-hidden w-full flex flex-col justify-between px-3 pt-2 pb-10 sm:px-8 sm:py-4 max-w-5xl mx-auto text-center">
      {/* Top Camera Activation Bar if browser blocked autoplay */}
      <div className="flex justify-center min-h-[34px] shrink-0">
        {cameraState.status !== 'active' && (
          <button
            type="button"
            onClick={onRequestCamera}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs sm:text-base shadow-lg transition-all cursor-pointer"
          >
            <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>הפעל מצלמה</span>
          </button>
        )}
      </div>

      {/* Center Hero Logo & CTA */}
      <main className="my-auto flex flex-col items-center gap-2.5 sm:gap-4 bg-slate-950/55 backdrop-blur-md border border-amber-300/25 rounded-3xl px-4 py-4 sm:px-10 sm:py-6 shadow-[0_20px_60px_rgba(9,18,44,0.85)]">
        <FestiveHanukkahLogo />

        <div className="space-y-1 sm:space-y-2">
          <h1 className="font-display text-2xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-amber-100 via-amber-400 to-orange-400 drop-shadow-[0_6px_22px_rgba(251,191,36,0.45)] text-balance">
            אליפות החנוכה של המשפחה!
          </h1>
          <p className="text-xs sm:text-lg text-sky-100 font-medium max-w-2xl mx-auto leading-snug line-clamp-3 sm:line-clamp-none">
            9 משחקי חנוכה אינטראקטיביים ללא מגע לשני שחקנים מול המצלמה — סופגניות, חנוכיות, סביבונים, מגן המכבים, שודדי המטבעות, מלחמת אבקת סוכר, זיכרון אורות, חרב המכבים ודו-קרב האלופים!
          </p>
        </div>

        <div className="flex flex-col items-center gap-2 mt-0.5 w-full">
          <button
            type="button"
            onClick={onStartParty}
            disabled={isStartingParty}
            className="flex items-center justify-center gap-2 px-5 py-3 sm:px-10 sm:py-4 rounded-3xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500 hover:from-amber-300 hover:via-orange-300 hover:to-rose-400 text-slate-950 font-display font-extrabold text-lg sm:text-3xl shadow-[0_0_40px_rgba(251,191,36,0.65)] animate-pulse hover:animate-none hover:scale-[1.04] active:scale-[0.98] transition-all cursor-pointer disabled:cursor-default disabled:hover:scale-100 border-2 border-amber-100"
          >
            <Sparkles className="w-5 h-5 sm:w-7 sm:h-7 shrink-0" />
            <span>
              {isStartingParty
                ? 'הקריין מברך את האלופים... 🎙️'
                : 'לחצו כאן להתחיל את החגיגה! 🎉'}
            </span>
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleTestSpeakers}
              disabled={testingAudio || isStartingParty}
              className="px-3.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/35 border border-sky-300/40 text-sky-100 text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {testingAudio ? 'משמיע: המערכת מוכנה! 🔊' : 'בדוק רמקולים 🔊'}
            </button>

            <button
              type="button"
              onClick={onSkipIntro}
              className={`px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                isStartingParty
                  ? 'bg-slate-800 hover:bg-slate-700 border border-amber-300/60 text-amber-200 shadow-md scale-105'
                  : 'text-sky-200/80 hover:text-white hover:bg-white/10'
              }`}
            >
              {isStartingParty ? 'דלג לתפריט המשחקים ⏭️' : 'דלג על ההסבר'}
            </button>
          </div>
        </div>
      </main>

      <footer className="text-[11px] sm:text-sm text-sky-100/80 pt-1 shrink-0">
        מומלץ להפעיל רמקולים כדי לשמוע את הקריין ואת מוזיקת החג!
      </footer>
    </div>
  );
};
