import type { AppSettings } from "../features/settings/useAppSettings";
import type { FocusMode, Session, Track } from "../types/player";
import type { FocusTimerState } from "../features/focus-timer/useFocusTimer";

export interface FocusTimerSnapshot {
  state: FocusTimerState;
  remainingSeconds: number;
  settings: {
    focusMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    breakBehavior: "continue" | "pause" | "lowerVolume";
    breakVolume: number;
  };
}

export interface RuntimeSnapshot {
  input: string;
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  activeSessionId: string | null;
  activeFocusModeId: string | null;
  sessions: Session[];
  modes: FocusMode[];
  focusTimer: FocusTimerSnapshot;
  settings: AppSettings;
  settingsImportError: string | null;
}
