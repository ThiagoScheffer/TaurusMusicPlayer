import { useEffect, useMemo, useRef, useState } from "react";

export type FocusTimerState = "idle" | "focus" | "shortBreak" | "longBreak" | "paused";
type ActivePhase = "focus" | "shortBreak" | "longBreak";
type BreakBehavior = "continue" | "pause" | "lowerVolume";

export interface FocusTimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  breakBehavior: BreakBehavior;
  breakVolume: number;
}

interface UseFocusTimerArgs {
  isPlaying: boolean;
  volume: number;
  play: () => void;
  pause: () => void;
  setVolume: (v: number) => void;
}

const SETTINGS_KEY = "taurus.focusTimer.settings";
const LONG_BREAK_INTERVAL = 4;

const DEFAULT_SETTINGS: FocusTimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  breakBehavior: "continue",
  breakVolume: 35,
};

function readSettings(): FocusTimerSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<FocusTimerSettings>;
    return {
      focusMinutes: Number(parsed.focusMinutes) > 0 ? Number(parsed.focusMinutes) : DEFAULT_SETTINGS.focusMinutes,
      shortBreakMinutes: Number(parsed.shortBreakMinutes) > 0 ? Number(parsed.shortBreakMinutes) : DEFAULT_SETTINGS.shortBreakMinutes,
      longBreakMinutes: Number(parsed.longBreakMinutes) > 0 ? Number(parsed.longBreakMinutes) : DEFAULT_SETTINGS.longBreakMinutes,
      breakBehavior:
        parsed.breakBehavior === "pause" || parsed.breakBehavior === "lowerVolume" || parsed.breakBehavior === "continue"
          ? parsed.breakBehavior
          : DEFAULT_SETTINGS.breakBehavior,
      breakVolume:
        Number.isFinite(parsed.breakVolume) && Number(parsed.breakVolume) >= 0 && Number(parsed.breakVolume) <= 100
          ? Number(parsed.breakVolume)
          : DEFAULT_SETTINGS.breakVolume,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function isBreakPhase(phase: ActivePhase) {
  return phase === "shortBreak" || phase === "longBreak";
}

export function useFocusTimer({ isPlaying, volume, play, pause, setVolume }: UseFocusTimerArgs) {
  const [settings, setSettings] = useState<FocusTimerSettings>(readSettings);
  const [state, setState] = useState<FocusTimerState>("idle");
  const [pausedFrom, setPausedFrom] = useState<ActivePhase | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(settings.focusMinutes * 60);
  const [endAtMs, setEndAtMs] = useState<number | null>(null);
  const [completedFocusCount, setCompletedFocusCount] = useState(0);

  const preBreakVolumeRef = useRef<number | null>(null);
  const wasPlayingBeforeBreakRef = useRef(false);

  const activePhase: ActivePhase | null = useMemo(() => {
    if (state === "focus" || state === "shortBreak" || state === "longBreak") return state;
    if (state === "paused") return pausedFrom;
    return null;
  }, [state, pausedFrom]);

  const secondsForPhase = (phase: ActivePhase) => {
    if (phase === "focus") return Math.max(1, Math.floor(settings.focusMinutes * 60));
    if (phase === "shortBreak") return Math.max(1, Math.floor(settings.shortBreakMinutes * 60));
    return Math.max(1, Math.floor(settings.longBreakMinutes * 60));
  };

  const applyFocusToBreakBehavior = () => {
    if (settings.breakBehavior === "pause") {
      wasPlayingBeforeBreakRef.current = isPlaying;
      if (isPlaying) pause();
      return;
    }

    if (settings.breakBehavior === "lowerVolume") {
      preBreakVolumeRef.current = volume;
      setVolume(settings.breakVolume);
    }
  };

  const applyBreakToFocusBehavior = () => {
    if (settings.breakBehavior === "pause") {
      if (wasPlayingBeforeBreakRef.current) {
        play();
      }
      wasPlayingBeforeBreakRef.current = false;
      return;
    }

    if (settings.breakBehavior === "lowerVolume") {
      if (preBreakVolumeRef.current !== null) {
        setVolume(preBreakVolumeRef.current);
        preBreakVolumeRef.current = null;
      }
    }
  };

  const transitionToPhase = (next: ActivePhase) => {
    const prev = activePhase;
    if (prev === "focus" && isBreakPhase(next)) {
      applyFocusToBreakBehavior();
    }
    if (prev && isBreakPhase(prev) && next === "focus") {
      applyBreakToFocusBehavior();
    }

    const nextSeconds = secondsForPhase(next);
    setState(next);
    setPausedFrom(null);
    setRemainingSeconds(nextSeconds);
    setEndAtMs(Date.now() + nextSeconds * 1000);
  };

  const start = () => {
    if (state !== "idle") return;
    transitionToPhase("focus");
  };

  const pauseTimer = () => {
    if (!(state === "focus" || state === "shortBreak" || state === "longBreak")) return;

    const now = Date.now();
    const remaining = endAtMs ? Math.max(0, Math.ceil((endAtMs - now) / 1000)) : remainingSeconds;
    setRemainingSeconds(remaining);
    setPausedFrom(state);
    setState("paused");
    setEndAtMs(null);
  };

  const resume = () => {
    if (state !== "paused" || !pausedFrom) return;
    const secs = Math.max(1, remainingSeconds);
    setState(pausedFrom);
    setPausedFrom(null);
    setEndAtMs(Date.now() + secs * 1000);
  };

  const reset = () => {
    setState("idle");
    setPausedFrom(null);
    setEndAtMs(null);
    setRemainingSeconds(secondsForPhase("focus"));
    setCompletedFocusCount(0);

    if (preBreakVolumeRef.current !== null) {
      setVolume(preBreakVolumeRef.current);
      preBreakVolumeRef.current = null;
    }
    wasPlayingBeforeBreakRef.current = false;
  };

  const advancePhase = (from: ActivePhase) => {
    if (from === "focus") {
      const nextFocusCount = completedFocusCount + 1;
      setCompletedFocusCount(nextFocusCount);
      const nextBreak: ActivePhase = nextFocusCount % LONG_BREAK_INTERVAL === 0 ? "longBreak" : "shortBreak";
      transitionToPhase(nextBreak);
      return;
    }

    transitionToPhase("focus");
  };

  const skipPhase = () => {
    if (state === "idle") return;
    if (state === "paused") {
      if (!pausedFrom) return;
      advancePhase(pausedFrom);
      return;
    }
    advancePhase(state);
  };

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!(state === "focus" || state === "shortBreak" || state === "longBreak") || !endAtMs) return;

    const tick = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        window.clearInterval(tick);
        advancePhase(state);
      }
    }, 250);

    return () => window.clearInterval(tick);
  }, [state, endAtMs, completedFocusCount]);

  useEffect(() => {
    if (state !== "idle") return;
    setRemainingSeconds(secondsForPhase("focus"));
  }, [settings.focusMinutes, state]);

  const setFocusMinutes = (minutes: number) => {
    setSettings((prev) => ({ ...prev, focusMinutes: Math.max(1, minutes) }));
  };

  const setShortBreakMinutes = (minutes: number) => {
    setSettings((prev) => ({ ...prev, shortBreakMinutes: Math.max(1, minutes) }));
  };

  const setLongBreakMinutes = (minutes: number) => {
    setSettings((prev) => ({ ...prev, longBreakMinutes: Math.max(1, minutes) }));
  };

  const restoreSettings = (next: FocusTimerSettings) => {
    setSettings({ ...next });
    reset();
  };

  return {
    state,
    remainingSeconds,
    settings,
    setFocusMinutes,
    setShortBreakMinutes,
    setLongBreakMinutes,
    setBreakBehavior: (breakBehavior: BreakBehavior) => setSettings((prev) => ({ ...prev, breakBehavior })),
    setBreakVolume: (breakVolume: number) =>
      setSettings((prev) => ({ ...prev, breakVolume: Math.min(100, Math.max(0, breakVolume)) })),
    restoreSettings,
    start,
    pauseTimer,
    resume,
    reset,
    skipPhase,
  };
}
