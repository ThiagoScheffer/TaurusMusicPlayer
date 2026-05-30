import { formatTime } from "../../lib/time";
import type { FocusTimerState } from "./useFocusTimer";

interface FocusTimerPanelProps {
  state: FocusTimerState;
  remainingSeconds: number;
  settings: {
    focusMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    breakBehavior: "continue" | "pause" | "lowerVolume";
    breakVolume: number;
  };
  setFocusMinutes: (minutes: number) => void;
  setShortBreakMinutes: (minutes: number) => void;
  setLongBreakMinutes: (minutes: number) => void;
  setBreakBehavior: (mode: "continue" | "pause" | "lowerVolume") => void;
  setBreakVolume: (volume: number) => void;
  start: () => void;
  pauseTimer: () => void;
  resume: () => void;
  reset: () => void;
  skipPhase: () => void;
}

function phaseLabel(state: FocusTimerState): string {
  if (state === "focus") return "Focus";
  if (state === "shortBreak") return "Short Break";
  if (state === "longBreak") return "Long Break";
  if (state === "paused") return "Paused";
  return "Idle";
}

export function FocusTimerPanel(props: FocusTimerPanelProps) {
  const {
    state,
    remainingSeconds,
    settings,
    setFocusMinutes,
    setShortBreakMinutes,
    setLongBreakMinutes,
    setBreakBehavior,
    setBreakVolume,
    start,
    pauseTimer,
    resume,
    reset,
    skipPhase,
  } = props;

  return (
    <div className="focus-panel">
      <div className="focus-header">
        <strong>Focus Timer</strong>
        <span>{phaseLabel(state)} · {formatTime(remainingSeconds)}</span>
      </div>

      <div className="focus-controls">
        <button className="btn small" onClick={start} disabled={state !== "idle"}>Start</button>
        <button className="btn small" onClick={pauseTimer} disabled={!(state === "focus" || state === "shortBreak" || state === "longBreak")}>Pause</button>
        <button className="btn small" onClick={resume} disabled={state !== "paused"}>Resume</button>
        <button className="btn small" onClick={reset}>Reset</button>
        <button className="btn small" onClick={skipPhase} disabled={state === "idle"}>Skip</button>
      </div>

      <div className="focus-settings">
        <label>Focus <input type="number" min={1} value={settings.focusMinutes} onChange={(e) => setFocusMinutes(Number(e.target.value) || 1)} /></label>
        <label>Short <input type="number" min={1} value={settings.shortBreakMinutes} onChange={(e) => setShortBreakMinutes(Number(e.target.value) || 1)} /></label>
        <label>Long <input type="number" min={1} value={settings.longBreakMinutes} onChange={(e) => setLongBreakMinutes(Number(e.target.value) || 1)} /></label>
      </div>

      <div className="focus-behavior">
        <label>
          Break Music
          <select value={settings.breakBehavior} onChange={(e) => setBreakBehavior(e.target.value as "continue" | "pause" | "lowerVolume") }>
            <option value="continue">Continue During Break</option>
            <option value="pause">Pause During Break</option>
            <option value="lowerVolume">Lower Volume During Break</option>
          </select>
        </label>
        {settings.breakBehavior === "lowerVolume" && (
          <label>
            Break Vol
            <input type="range" min={0} max={100} value={settings.breakVolume} onChange={(e) => setBreakVolume(Number(e.target.value))} />
          </label>
        )}
      </div>
    </div>
  );
}
