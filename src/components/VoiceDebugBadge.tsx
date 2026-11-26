import React, { useEffect, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { soundEngine, VoiceDebugInfo } from '../audio/soundEngine';

export const VoiceDebugBadge: React.FC = () => {
  const [info, setInfo] = useState<VoiceDebugInfo>(() => soundEngine.getVoiceDebugInfo());
  const [hidden, setHidden] = useState<boolean>(false);

  useEffect(() => {
    setInfo(soundEngine.getVoiceDebugInfo());
    return soundEngine.onVoiceChange((next) => {
      setInfo(next);
    });
  }, []);

  if (hidden) return null;

  return (
    <div
      dir="rtl"
      role="status"
      aria-label="סטטוס קול דפדפן"
      className="fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded-lg bg-slate-950/85 backdrop-blur-md border border-sky-300/30 px-2.5 py-1.5 text-[11px] sm:text-xs text-sky-100 shadow-lg max-w-[92vw] sm:max-w-sm"
    >
      <Volume2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
      <span className="truncate font-medium">
        {info.label}
        {info.engine === 'browser' && info.count > 0 ? ` (${info.count} קולות)` : ''}
        {info.lastEvent ? ` · ${info.lastEvent}` : ''}
      </span>
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="הסתר שורת סטטוס קול"
        title="הסתר"
        className="p-0.5 rounded hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
