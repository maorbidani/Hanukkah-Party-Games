export type GameMode =
  | 'sufganiyot'
  | 'hanukkiah'
  | 'dreidel'
  | 'maccabees'
  | 'coins'
  | 'sugarwar'
  | 'simon'
  | 'sword'
  | 'duel';

export type GameDuration = 30 | 60 | 90;

export type ScreenState = 'SPLASH' | 'MENU' | 'PLAYING' | 'VICTORY';

export type SensitivityLevel = 'low' | 'medium' | 'high';

export type PlayerSide = 'left' | 'right';

export interface PlayerScores {
  left: number;
  right: number;
}

export interface GameConfig {
  mode: GameMode;
  duration: GameDuration;
  sensitivity: SensitivityLevel;
}

export interface GameResult {
  mode: GameMode;
  duration: GameDuration;
  scores: PlayerScores;
}

export interface CameraState {
  status: 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
  errorMessage?: string;
}

export interface HandTrackerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  handsCount: number;
}
