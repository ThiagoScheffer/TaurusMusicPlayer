import { useState } from "react";
import type { FocusMode, Session } from "../../types/player";

interface FocusModesPanelProps {
  modes: FocusMode[];
  sessions: Session[];
  activeModeId: string;
  onSelectMode: (modeId: string) => void;
  onCreateMode: (name: string) => void;
  onEditMode: (modeId: string, update: Partial<FocusMode>) => void;
  onDeleteMode: (modeId: string) => void;
}

export function FocusModesPanel({
  modes,
  sessions,
  activeModeId,
  onSelectMode,
  onCreateMode,
  onEditMode,
  onDeleteMode,
}: FocusModesPanelProps) {
  const [newModeName, setNewModeName] = useState("Custom Mode");

  return (
    <div className="modes-panel">
      <div className="modes-header">
        <strong>Focus Modes</strong>
        <div className="modes-create">
          <input value={newModeName} onChange={(e) => setNewModeName(e.target.value)} />
          <button className="btn small" onClick={() => onCreateMode(newModeName)}>Create</button>
        </div>
      </div>

      <div className="modes-list">
        {modes.map((mode) => (
          <div key={mode.id} className={`mode-item ${mode.id === activeModeId ? "active" : ""}`}>
            <div className="mode-meta">
              <div className="mode-title">{mode.name}</div>
              <div className="mode-sub">{mode.themeIntensity} · vol {mode.defaultVolume}</div>
            </div>
            <div className="mode-actions">
              <button className="btn small" onClick={() => onSelectMode(mode.id)}>Select</button>
              <button
                className="btn small"
                onClick={() => {
                  const name = window.prompt("Mode name", mode.name);
                  if (name) onEditMode(mode.id, { name: name.trim() });
                }}
              >
                Rename
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const vol = window.prompt("Default volume (0-100)", String(mode.defaultVolume));
                  if (!vol) return;
                  const n = Number(vol);
                  if (!Number.isFinite(n)) return;
                  onEditMode(mode.id, { defaultVolume: n });
                }}
              >
                Volume
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const intensity = window.prompt("Theme intensity: calm | neutral | intense", mode.themeIntensity);
                  if (intensity === "calm" || intensity === "neutral" || intensity === "intense") {
                    onEditMode(mode.id, { themeIntensity: intensity });
                  }
                }}
              >
                Intensity
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const options = sessions.map((s) => `${s.id}: ${s.name}`).join("\n");
                  const input = window.prompt(`Preferred Session ID (blank to clear)\n${options}`, mode.preferredSessionId ?? "");
                  if (input === null) return;
                  const id = input.trim();
                  onEditMode(mode.id, { preferredSessionId: id || undefined });
                }}
              >
                Pref Session
              </button>
              <button
                className="btn small"
                onClick={() => {
                  if (window.confirm(`Delete focus mode \"${mode.name}\"?`)) onDeleteMode(mode.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
