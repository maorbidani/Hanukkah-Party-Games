import React from 'react';
import { AlertTriangle, Camera, Hand, Volume2, VolumeX } from 'lucide-react';
import {
  CameraState,
  GameDuration,
  GameMode,
  HandTrackerState,
  SensitivityLevel,
} from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';

interface MainMenuProps {
  duration: GameDuration;
  onSelectDuration: (duration: GameDuration) => void;
  sensitivity: SensitivityLevel;
  onSelectSensitivity: (level: SensitivityLevel) => void;
  onStartGame: (mode: GameMode) => void;
  cameraState: CameraState;
  handTrackerStatus: HandTrackerState['status'];
  onRequestCamera: () => void;
  muted: boolean;
  onToggleMute: () => void;
  isIntroSpeaking: boolean;
  onSkipIntroSpeech: () => void;
}

const DURATIONS: GameDuration[] = [30, 60, 90];

const SENSITIVITIES: Array<{ id: SensitivityLevel; label: string }> = [
  { id: 'low', label: 'נמוכה' },
  { id: 'medium', label: 'רגילה' },
  { id: 'high', label: 'גבוהה' },
];

const GAMES: Array<{
  mode: GameMode;
  emoji: string;
  title: string;
  description: string;
  gradient: string;
  border: string;
  shadow: string;
}> = [
  {
    mode: 'sufganiyot',
    emoji: '🍩',
    title: 'אכול את הסופגניות',
    description: 'פוצצו סופגניות באוויר והיזהרו מהפצצות!',
    gradient: 'from-rose-500/95 via-amber-500/95 to-orange-500/95',
    border: 'border-amber-300/75',
    shadow: 'shadow-[0_10px_24px_rgba(245,158,11,0.3)]',
  },
  {
    mode: 'hanukkiah',
    emoji: '🕎',
    title: 'הדלק את החנוכיות',
    description: 'תפסו את השמש בפינה והדליקו 8 נרות!',
    gradient: 'from-sky-500/95 via-blue-600/95 to-indigo-600/95',
    border: 'border-sky-300/75',
    shadow: 'shadow-[0_10px_24px_rgba(56,189,248,0.3)]',
  },
  {
    mode: 'dreidel',
    emoji: '🌀',
    title: 'מרוץ הסביבונים',
    description: 'נופפו ידיים מהר וסובבו את הסביבון לשיא!',
    gradient: 'from-emerald-500/95 via-teal-500/95 to-cyan-600/95',
    border: 'border-emerald-300/75',
    shadow: 'shadow-[0_10px_24px_rgba(16,185,129,0.3)]',
  },
  {
    mode: 'maccabees',
    emoji: '🛡️',
    title: 'מגן המכבים',
    description: 'חסמו עם המגן חיצים וכדורי אש נופלים!',
    gradient: 'from-violet-500/95 via-purple-600/95 to-indigo-700/95',
    border: 'border-violet-300/75',
    shadow: 'shadow-[0_10px_24px_rgba(139,92,246,0.32)]',
  },
  {
    mode: 'coins',
    emoji: '🪙',
    title: 'שודדי המטבעות',
    description: 'תפסו מטבעות שוקולד ושקיות זהב — היזהרו מהפחמים!',
    gradient: 'from-amber-400/95 via-yellow-500/95 to-amber-600/95',
    border: 'border-yellow-200/80',
    shadow: 'shadow-[0_10px_24px_rgba(234,179,8,0.32)]',
  },
  {
    mode: 'sugarwar',
    emoji: '❄️',
    title: 'מלחמת אבקת סוכר',
    description: 'זרקו כדורי סוכר ליריב וכסו לו את המסך ל-3 שניות!',
    gradient: 'from-cyan-500/95 via-sky-500/95 to-blue-600/95',
    border: 'border-cyan-200/80',
    shadow: 'shadow-[0_10px_24px_rgba(6,182,212,0.32)]',
  },
  {
    mode: 'simon',
    emoji: '💡',
    title: 'זיכרון אורות',
    description: 'זכרו איזה לפידים נדלקים וגעו בהם לפי הסדר!',
    gradient: 'from-pink-500/95 via-fuchsia-600/95 to-purple-700/95',
    border: 'border-pink-200/80',
    shadow: 'shadow-[0_10px_24px_rgba(236,72,153,0.32)]',
  },
  {
    mode: 'sword',
    emoji: '⚔️',
    title: 'חרב המכבים',
    description: 'הניפו חרב זוהרת וחסלו קבוצות יוונים שמסתערים מלמעלה!',
    gradient: 'from-indigo-600/95 via-blue-700/95 to-amber-500/95',
    border: 'border-amber-300/80',
    shadow: 'shadow-[0_10px_24px_rgba(99,102,241,0.34)]',
  },
  {
    mode: 'duel',
    emoji: '🥊',
    title: 'דו-קרב האלופים (1 נגד 1)',
    description: 'נופפו ידיים מהר, שגרו מכות ברק והורידו ליריב את מד החיים ל-0%!',
    gradient: 'from-rose-600/95 via-red-600/95 to-amber-500/95',
    border: 'border-rose-300/85',
    shadow: 'shadow-[0_10px_24px_rgba(244,63,94,0.36)]',
  },
];

export const MainMenu: React.FC<MainMenuProps> = ({
  duration,
  onSelectDuration,
  sensitivity,
  onSelectSensitivity,
  onStartGame,
  cameraState,
  handTrackerStatus,
  onRequestCamera,
  muted,
  onToggleMute,
  isIntroSpeaking,
  onSkipIntroSpeech,
}) => {
  const cameraNeedsActivation = cameraState.status !== 'active';

  return (
    <div className="relative z-10 h-dvh w-full flex flex-col justify-between px-3 pt-2 pb-12 md:px-8 md:pt-3 lg:pb-3 max-w-7xl mx-auto overflow-y-auto lg:overflow-hidden">
      {/* Top Camera Bar & Controls */}
      <div className="space-y-1.5 shrink-0">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 backdrop-blur-md border border-white/15 rounded-2xl px-4 py-2 shadow-lg">
          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm font-medium">
            {cameraNeedsActivation ? (
              <button
                type="button"
                onClick={onRequestCamera}
                disabled={cameraState.status === 'requesting'}
                className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 disabled:opacity-70 text-slate-950 font-extrabold text-sm shadow-[0_6px_18px_rgba(251,191,36,0.45)] transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>
                  {cameraState.status === 'requesting' ? 'מבקש גישה למצלמה...' : 'הפעל מצלמה'}
                </span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-emerald-300 font-bold">
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>מצלמת מראה פעילה</span>
                </span>
                <span className="flex items-center gap-1.5 text-amber-200 text-xs sm:text-sm">
                  <Hand className="w-4 h-4 shrink-0" />
                  <span>
                    {handTrackerStatus === 'ready'
                      ? 'זיהוי ידיים MediaPipe פעיל'
                      : handTrackerStatus === 'loading'
                      ? 'טוען זיהוי ידיים...'
                      : 'זיהוי תנועה פעיל'}
                  </span>
                </span>
              </div>
            )}

            {isIntroSpeaking && (
              <button
                type="button"
                onClick={onSkipIntroSpeech}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-amber-300/30 text-amber-200 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                דלג על ההסבר
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <PWAInstallButton />

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-200 whitespace-nowrap">רגישות:</span>
              <div className="flex items-center gap-1 bg-slate-950/75 p-0.5 rounded-xl border border-white/10">
                {SENSITIVITIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectSensitivity(item.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      sensitivity === item.id
                        ? 'bg-amber-400 text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'הפעל צלילים' : 'השתק צלילים'}
              className="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-white/15 text-amber-200 transition-colors cursor-pointer shrink-0"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {(cameraState.status === 'denied' || cameraState.status === 'unavailable') && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 bg-rose-950/90 backdrop-blur-md border border-rose-400/80 rounded-xl px-4 py-2 text-rose-100 shadow-lg"
          >
            <div className="flex items-center gap-2 text-xs sm:text-sm">
              <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
              <span>
                <strong className="font-extrabold text-white ml-1">
                  {cameraState.status === 'denied' ? 'המצלמה חסומה בדפדפן:' : 'מצלמה לא זמינה:'}
                </strong>
                {cameraState.errorMessage || 'אשרו גישה למצלמה בדפדפן ולחצו "הפעל מצלמה".'}
              </span>
            </div>
            <button
              type="button"
              onClick={onRequestCamera}
              className="px-3 py-1 rounded-lg bg-rose-400 hover:bg-rose-300 text-slate-950 font-extrabold text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              נסה שוב
            </button>
          </div>
        )}
      </div>

      {/* Main Content: Header + 9-Game Grid (3x3) */}
      <main className="my-auto py-1 flex flex-col items-center gap-2 md:gap-2.5 w-full">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 w-full bg-slate-950/55 backdrop-blur-sm rounded-2xl px-4 py-2 border border-white/10">
          <div className="text-center sm:text-right">
            <h1 className="font-display text-xl sm:text-3xl md:text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-orange-400">
              אליפות החנוכה — 9 משחקים!
            </h1>
            <p className="text-xs sm:text-sm text-sky-100 font-medium">
              שחקן בימין ושחקן בשמאל מול המצלמה — בחרו משחק ומשך סיבוב!
            </p>
          </div>

          <section
            aria-label="בחירת משך משחק"
            className="flex flex-wrap items-center justify-center gap-2 bg-slate-900/85 border border-amber-300/25 rounded-xl px-3 py-1.5 shrink-0"
          >
            <span className="text-xs sm:text-sm font-bold text-amber-200 whitespace-nowrap">
              משך סיבוב:
            </span>
            <div className="flex items-center gap-1.5">
              {DURATIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onSelectDuration(sec)}
                  className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-extrabold tabular-nums transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    duration === sec
                      ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 shadow-md scale-105'
                      : 'bg-slate-800/85 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {sec} שניות
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* 9 Game Cards: 3x3 symmetric grid on desktop, 2 columns on mobile */}
        <section
          aria-label="בחירת משחק"
          className="w-full grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-2.5"
        >
          {GAMES.map((game) => (
            <button
              key={game.mode}
              type="button"
              onClick={() => onStartGame(game.mode)}
              className={`group relative flex flex-col justify-between text-right p-3 md:p-3.5 rounded-2xl bg-gradient-to-br ${game.gradient} border-2 ${game.border} ${game.shadow} hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer min-h-[100px] lg:min-h-[108px] backdrop-blur-xs`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5 flex-1">
                  <h2 className="font-display text-base sm:text-xl md:text-2xl font-bold text-white drop-shadow-sm leading-tight">
                    {game.title}
                  </h2>
                  <p className="text-[11px] sm:text-xs md:text-sm text-white/95 font-medium leading-snug line-clamp-2">
                    {game.description}
                  </p>
                </div>
                <span className="text-3xl sm:text-4xl md:text-5xl drop-shadow-md animate-float-slow select-none shrink-0">
                  {game.emoji}
                </span>
              </div>

              <div className="mt-2 pt-1.5 border-t border-white/20 flex items-center justify-between text-[11px] md:text-sm font-extrabold text-amber-100">
                <span>שחקו עכשיו</span>
                <span className="group-hover:translate-x-[-4px] transition-transform">←</span>
              </div>
            </button>
          ))}
        </section>
      </main>

      <footer className="text-center text-xs text-sky-100/85 bg-slate-950/45 backdrop-blur-xs rounded-xl px-4 py-1.5 self-center shrink-0">
        <span>מעקב כף יד (Landmark 9) עם אזור פגיעה רחב פי 3</span>
        <span className="mx-2" aria-hidden="true">·</span>
        <span>תומך גם בעכבר ומגע</span>
      </footer>
    </div>
  );
};
