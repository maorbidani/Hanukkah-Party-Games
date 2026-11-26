import { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { GameArena } from './components/GameArena';
import { BRIEFING_SCRIPTS } from './components/GameBriefingTutorial';
import { MainMenu } from './components/MainMenu';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SplashIntro } from './components/SplashIntro';
import { VictoryScreen } from './components/VictoryScreen';
import { VoiceDebugBadge } from './components/VoiceDebugBadge';
import {
  CameraState,
  GameDuration,
  GameMode,
  GameResult,
  HandTrackerState,
  PlayerScores,
  ScreenState,
  SensitivityLevel,
} from './types/game';
import { HandTracker } from './vision/handTracker';

const CAMERA_ACTIVE_MODES: ReadonlySet<GameMode> = new Set<GameMode>([
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

const INTRO_MC_SPEECH =
  'שלום לכל המתמודדים! ברוכים הבאים לזירת האלופים של חנוכה! הערב, רק המהירים, החדים והאמיצים ביותר יזכו בגביע הניצחון! הכינו את הידיים... האתגר הגדול מתחיל עכשיו!';

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('SPLASH');
  const [mode, setMode] = useState<GameMode>('sufganiyot');
  const [duration, setDuration] = useState<GameDuration>(60);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [muted, setMuted] = useState<boolean>(false);
  const [isSplashSpeaking, setIsSplashSpeaking] = useState<boolean>(false);
  const [isIntroSpeaking, setIsIntroSpeaking] = useState<boolean>(false);
  const [result, setResult] = useState<GameResult | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>({ status: 'idle' });
  const [handTrackerStatus, setHandTrackerStatus] = useState<HandTrackerState['status']>('idle');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handTrackerRef = useRef<HandTracker>(new HandTracker());
  const splashSafetyTimerRef = useRef<number | null>(null);
  const splashSessionRef = useRef<number>(0);

  const requestCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState({
        status: 'unavailable',
        errorMessage: 'הדפדפן או המכשיר אינם תומכים בגישה למצלמת רשת (ודאו שהאתר פתוח בחיבור מאובטח HTTPS).',
      });
      return;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setCameraState({ status: 'requesting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraState({ status: 'active' });

      setHandTrackerStatus('loading');
      await handTrackerRef.current.initialize();
      setHandTrackerStatus(handTrackerRef.current.getStatus());
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setCameraState({
          status: 'denied',
          errorMessage:
            'הגישה למצלמה נחסמה. לחצו על סמל המנעול או המצלמה בשורת הכתובת של הדפדפן, אשרו "מצלמה" ולאחר מכן לחצו על "הפעל מצלמה".',
        });
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraState({
          status: 'unavailable',
          errorMessage:
            'לא נמצאה מצלמת רשת מחוברת למכשיר. חברו מצלמה ולחצו על "הפעל מצלמה" (ניתן לשחק בינתיים עם העכבר או מגע).',
        });
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setCameraState({
          status: 'unavailable',
          errorMessage:
            'המצלמה תפוסה כרגע על ידי תוכנה אחרת (כגון זום או לשונית אחרת). סגרו אותה ולחצו על "הפעל מצלמה".',
        });
      } else {
        setCameraState({
          status: 'denied',
          errorMessage:
            'לא הצלחנו להפעיל את המצלמה אוטומטית. לחצו על הכפתור "הפעל מצלמה" למעלה ואשרו גישה בחלונית הדפדפן.',
        });
      }
    }
  }, []);

  useEffect(() => {
    requestCamera();
    soundEngine.initVoices();
    void soundEngine.prefetchWebSpeech(['המערכת מוכנה!']);
    return () => {
      if (splashSafetyTimerRef.current !== null) {
        window.clearTimeout(splashSafetyTimerRef.current);
      }
      soundEngine.stopBackgroundMusic();
      soundEngine.stopSpeech();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [requestCamera]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      if (next) setIsIntroSpeaking(false);
      return next;
    });
  }, []);

  const finishSplashToMenu = useCallback((sessionId: number) => {
    if (sessionId !== splashSessionRef.current) return;
    splashSessionRef.current++;
    if (splashSafetyTimerRef.current !== null) {
      window.clearTimeout(splashSafetyTimerRef.current);
      splashSafetyTimerRef.current = null;
    }
    setIsSplashSpeaking(false);
    setIsIntroSpeaking(false);
    setScreen('MENU');
  }, []);

  // Speak welcoming announcer greeting automatically if browser allows, or immediately on entry click
  useEffect(() => {
    if (screen === 'MENU') {
      void soundEngine.prefetchWebSpeech(['שלוש', 'שתיים', 'אחת', 'צא לדרך!']);
      return;
    }
    if (screen !== 'SPLASH') return;
    const onFirstGesture = () => {
      soundEngine.unlock();
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
    };
  }, [screen]);

  const handleStartParty = useCallback(() => {
    if (isSplashSpeaking) return;
    soundEngine.unlock();
    soundEngine.startBackgroundMusic();
    if (cameraState.status === 'idle') {
      requestCamera();
    }

    splashSessionRef.current++;
    const sessionId = splashSessionRef.current;
    setIsSplashSpeaking(true);
    const clickTime = performance.now();

    if (splashSafetyTimerRef.current !== null) {
      window.clearTimeout(splashSafetyTimerRef.current);
    }
    // 15-second max timeout on splash intro
    splashSafetyTimerRef.current = window.setTimeout(() => {
      finishSplashToMenu(sessionId);
    }, 15000);

    void soundEngine.speakHebrew(INTRO_MC_SPEECH, {
      rate: 0.95,
      pitch: 0.85,
      volume: 1.0,
      duckLevel: 0.2,
      onEnd: () => {
        const elapsed = performance.now() - clickTime;
        // If browser speech ended too abruptly (< 2s), hold greeting briefly so transition never feels jarring
        if (elapsed < 2000) {
          window.setTimeout(() => finishSplashToMenu(sessionId), 3500 - elapsed);
        } else {
          finishSplashToMenu(sessionId);
        }
      },
    });
  }, [isSplashSpeaking, cameraState.status, requestCamera, finishSplashToMenu]);

  const handleSkipIntro = useCallback(() => {
    splashSessionRef.current++;
    if (splashSafetyTimerRef.current !== null) {
      window.clearTimeout(splashSafetyTimerRef.current);
      splashSafetyTimerRef.current = null;
    }
    soundEngine.unlock();
    soundEngine.stopSpeech();
    soundEngine.startBackgroundMusic();
    setIsSplashSpeaking(false);
    setIsIntroSpeaking(false);
    if (cameraState.status === 'idle') {
      requestCamera();
    }
    setScreen('MENU');
  }, [cameraState.status, requestCamera]);

  const handleSkipIntroSpeech = useCallback(() => {
    soundEngine.stopSpeech();
    setIsIntroSpeaking(false);
  }, []);

  const handleStartGame = useCallback(
    (selectedMode: GameMode) => {
      soundEngine.unlock();
      soundEngine.startBackgroundMusic();
      void soundEngine.speakHebrew(BRIEFING_SCRIPTS[selectedMode].speech, {
        duckLevel: 0.15,
        rate: 0.95,
        pitch: 0.85,
        volume: 1.0,
      });
      setIsIntroSpeaking(false);
      if (cameraState.status === 'idle') {
        requestCamera();
      } else if (videoRef.current && videoRef.current.paused && streamRef.current) {
        videoRef.current.play().catch(() => {});
      }
      if (CAMERA_ACTIVE_MODES.has(selectedMode)) {
        void handTrackerRef.current.initialize();
      }
      setMode(selectedMode);
      setResult(null);
      setScreen('PLAYING');
    },
    [cameraState.status, requestCamera]
  );

  const handleGameEnd = useCallback(
    (finalScores: PlayerScores) => {
      setResult({
        mode,
        duration,
        scores: finalScores,
      });
      setScreen('VICTORY');
    },
    [mode, duration]
  );

  const handlePlayAgain = useCallback(() => {
    soundEngine.unlock();
    soundEngine.startBackgroundMusic();
    void soundEngine.speakHebrew(BRIEFING_SCRIPTS[mode].speech, {
      duckLevel: 0.15,
      rate: 0.95,
      pitch: 0.85,
      volume: 1.0,
    });
    if (videoRef.current && videoRef.current.paused && streamRef.current) {
      videoRef.current.play().catch(() => {});
    }
    setResult(null);
    setScreen('PLAYING');
  }, [mode]);

  const handleBackToMenu = useCallback(() => {
    soundEngine.stopSpeech();
    soundEngine.startBackgroundMusic();
    setIsIntroSpeaking(false);
    setScreen('MENU');
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#09122C]">
      {/* Festive Hanukkah Night Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_20%,rgba(56,189,248,0.22),transparent_55%),radial-gradient(circle_at_20%_80%,rgba(245,158,11,0.16),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.16),transparent_50%)]"
      />

      {/* Mirrored Full-Screen Webcam Video at Clear 0.65 Opacity across all modes (including sword & duel) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden="true"
        className={`fixed inset-0 z-[1] w-full h-full object-cover scale-x-[-1] pointer-events-none transition-opacity duration-500 ${
          cameraState.status === 'active' && (screen !== 'PLAYING' || CAMERA_ACTIVE_MODES.has(mode))
            ? 'opacity-[0.65]'
            : 'opacity-0'
        }`}
      />

      {/* Light Scrim so kids clearly see themselves at 0.65 opacity while UI stays crisp */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-[2] pointer-events-none transition-colors duration-300 ${
          screen === 'PLAYING' ? 'bg-slate-950/15' : 'bg-slate-950/25'
        }`}
      />

      {screen === 'SPLASH' && (
        <SplashIntro
          onStartParty={handleStartParty}
          onSkipIntro={handleSkipIntro}
          cameraState={cameraState}
          onRequestCamera={requestCamera}
          isStartingParty={isSplashSpeaking}
        />
      )}

      {screen === 'MENU' && (
        <MainMenu
          duration={duration}
          onSelectDuration={setDuration}
          sensitivity={sensitivity}
          onSelectSensitivity={setSensitivity}
          onStartGame={handleStartGame}
          cameraState={cameraState}
          handTrackerStatus={handTrackerStatus}
          onRequestCamera={requestCamera}
          muted={muted}
          onToggleMute={handleToggleMute}
          isIntroSpeaking={isIntroSpeaking}
          onSkipIntroSpeech={handleSkipIntroSpeech}
        />
      )}

      {screen === 'PLAYING' && (
        <GameArena
          mode={mode}
          duration={duration}
          sensitivity={sensitivity}
          videoRef={videoRef}
          handTrackerRef={handTrackerRef}
          cameraState={cameraState}
          onRequestCamera={requestCamera}
          muted={muted}
          onToggleMute={handleToggleMute}
          onExitToMenu={handleBackToMenu}
          onGameEnd={handleGameEnd}
        />
      )}

      {screen === 'VICTORY' && result && (
        <VictoryScreen
          result={result}
          onPlayAgain={handlePlayAgain}
          onBackToMenu={handleBackToMenu}
        />
      )}

      <OfflineIndicator />
      {screen !== 'PLAYING' && <VoiceDebugBadge />}
    </div>
  );
}
