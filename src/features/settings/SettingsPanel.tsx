import { useState } from "react";
import type { BlacklistEntryType } from "../../types/player";
import type { AppSettings } from "./useAppSettings";

interface SettingsPanelProps {
  settings: AppSettings;
  setPlayback: (patch: Partial<AppSettings["playback"]>) => void;
  hotkeys: string[];
  focusTimer: {
    focusMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    breakBehavior: "continue" | "pause" | "lowerVolume";
  };
  setFocusMinutes: (minutes: number) => void;
  setShortBreakMinutes: (minutes: number) => void;
  setLongBreakMinutes: (minutes: number) => void;
  setBreakBehavior: (behavior: "continue" | "pause" | "lowerVolume") => void;
  exportBackup: () => void;
  importBackup: () => void;
  resetAllData: () => boolean;
  importError: string | null;
  backupStatus: string | null;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    settings,
    setPlayback,
    hotkeys,
    focusTimer,
    setFocusMinutes,
    setShortBreakMinutes,
    setLongBreakMinutes,
    setBreakBehavior,
    exportBackup,
    importBackup,
    resetAllData,
    importError,
    backupStatus,
  } = props;

  const [blacklistType, setBlacklistType] = useState<BlacklistEntryType>("video");
  const [blacklistValue, setBlacklistValue] = useState("");

  const addBlacklistEntry = () => {
    const value = blacklistValue.trim();
    if (!value) return;
    setPlayback({
      blacklistEntries: [
        ...settings.playback.blacklistEntries,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: blacklistType,
          value,
          createdAt: Date.now(),
        },
      ],
    });
    setBlacklistValue("");
  };

  return (
    <div className="settings-panel">
      <strong>Settings</strong>

      <div className="settings-section">
        <h4>Playback</h4>
        <label>Default Volume
          <input type="number" min={0} max={100} value={settings.playback.defaultVolume} onChange={(e) => setPlayback({ defaultVolume: Number(e.target.value) || 0 })} />
        </label>
        <label><input type="checkbox" checked={settings.playback.autoplayNext} onChange={(e) => setPlayback({ autoplayNext: e.target.checked })} /> Autoplay Next</label>
        <label><input type="checkbox" checked={settings.playback.rememberLastTrack} onChange={(e) => setPlayback({ rememberLastTrack: e.target.checked })} /> Remember Last Track</label>
        <label><input type="checkbox" checked={settings.playback.skipBlacklistedTracks} onChange={(e) => setPlayback({ skipBlacklistedTracks: e.target.checked })} /> Skip Blacklisted Tracks</label>
        <div className="row" style={{ gap: 8 }}>
          <select value={blacklistType} onChange={(e) => setBlacklistType(e.target.value as BlacklistEntryType)}>
            <option value="video">Video ID / Link</option>
            <option value="category">Music Category/Type</option>
            <option value="genre">Genre</option>
            <option value="keyword">Keyword</option>
          </select>
          <input value={blacklistValue} onChange={(e) => setBlacklistValue(e.target.value)} placeholder="Blacklist value" />
          <button className="btn small" onClick={addBlacklistEntry}>Add</button>
        </div>
        {settings.playback.blacklistEntries.map((entry) => (
          <div key={entry.id} className="queue-item">
            <div className="queue-meta">
              <div className="queue-title">{entry.value}</div>
              <div className="queue-sub">{entry.type}</div>
            </div>
            <button
              className="btn small"
              onClick={() =>
                setPlayback({
                  blacklistEntries: settings.playback.blacklistEntries.filter((item) => item.id !== entry.id),
                })
              }
            >
              Restore
            </button>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h4>Hotkeys</h4>
        {hotkeys.map((hk) => <div key={hk}>{hk}</div>)}
        <div>CapsLock is not supported as a modifier for global shortcuts.</div>
      </div>

      <div className="settings-section">
        <h4>Focus Timer</h4>
        <label>Focus Minutes <input type="number" min={1} value={focusTimer.focusMinutes} onChange={(e) => setFocusMinutes(Number(e.target.value) || 1)} /></label>
        <label>Short Break Minutes <input type="number" min={1} value={focusTimer.shortBreakMinutes} onChange={(e) => setShortBreakMinutes(Number(e.target.value) || 1)} /></label>
        <label>Long Break Minutes <input type="number" min={1} value={focusTimer.longBreakMinutes} onChange={(e) => setLongBreakMinutes(Number(e.target.value) || 1)} /></label>
        <label>Break Music Behavior
          <select value={focusTimer.breakBehavior} onChange={(e) => setBreakBehavior(e.target.value as "continue" | "pause" | "lowerVolume")}>
            <option value="continue">Continue During Break</option>
            <option value="pause">Pause During Break</option>
            <option value="lowerVolume">Lower Volume During Break</option>
          </select>
        </label>
      </div>

      <div className="settings-section">
        <h4>Data</h4>
        <button className="btn small" onClick={exportBackup}>Export Backup...</button>
        <button className="btn small" onClick={importBackup}>Import Backup...</button>
        {backupStatus && <div className="queue-sub">{backupStatus}</div>}
        {importError && <div className="settings-error">Import error: {importError}</div>}
        <button className="btn small" onClick={resetAllData}>Reset All Data</button>
      </div>
    </div>
  );
}
