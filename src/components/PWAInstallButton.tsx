import React, { useState } from 'react';
import { MoreVertical, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);

  // Automatically hide install button if already running as installed standalone app
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:via-teal-300 hover:to-cyan-300 text-slate-950 font-extrabold text-xs sm:text-sm shadow-[0_6px_18px_rgba(20,184,166,0.45)] hover:scale-[1.03] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-4 h-4 shrink-0" />
        <span>התקן כאפליקציה לפלאפון 📲</span>
      </button>

      {showGuideModal && (
        <div
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-slate-900 border-2 border-amber-300/60 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.75)] text-right space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt="סמל אליפות החנוכה"
                  className="w-11 h-11 rounded-xl border border-amber-300/50 shrink-0"
                />
                <div>
                  <h2
                    id="pwa-install-title"
                    className="font-display text-xl font-extrabold text-amber-300 leading-tight"
                  >
                    להתקנה כאייקון במסך הבית:
                  </h2>
                  <p className="text-xs text-sky-200/85">הפעלה במסך מלא ללא שורת כתובת</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="סגור חלונית התקנה"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="space-y-3 text-sm sm:text-base text-slate-100 leading-relaxed">
              <li className="flex items-start gap-3 bg-slate-950/60 border border-white/10 rounded-2xl p-3.5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500/25 text-sky-300 font-extrabold shrink-0">
                  1
                </span>
                <div className="flex-1 space-y-1.5">
                  <p className="font-semibold">
                    לחצו על כפתור השיתוף (ריבוע עם חץ למעלה) או על 3 הנקודות בדפדפן.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-amber-200/90">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 border border-white/10">
                      <Share className="w-3.5 h-3.5 text-sky-300" />
                      <span>שיתוף (iPhone)</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 border border-white/10">
                      <MoreVertical className="w-3.5 h-3.5 text-amber-300" />
                      <span>תפריט (Android)</span>
                    </span>
                  </div>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-slate-950/60 border border-white/10 rounded-2xl p-3.5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/25 text-emerald-300 font-extrabold shrink-0">
                  2
                </span>
                <div className="flex-1 flex items-center justify-between gap-2">
                  <p className="font-semibold">
                    בחרו ב-<strong>&quot;הוסף למסך הבית&quot;</strong> (Add to Home Screen).
                  </p>
                  <PlusSquare className="w-5 h-5 text-emerald-300 shrink-0" />
                </div>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 font-extrabold text-base transition-all cursor-pointer"
            >
              הבנתי, תודה!
            </button>
          </div>
        </div>
      )}
    </>
  );
};
