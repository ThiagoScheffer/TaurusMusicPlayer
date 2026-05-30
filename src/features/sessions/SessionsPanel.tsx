import { useState } from "react";
import type { Session } from "../../types/player";

interface SessionsPanelProps {
  sessions: Session[];
  onSaveCurrentQueue: (name: string) => void;
  onStartSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SessionsPanel({
  sessions,
  onSaveCurrentQueue,
  onStartSession,
  onRenameSession,
  onDuplicateSession,
  onDeleteSession,
}: SessionsPanelProps) {
  const [newName, setNewName] = useState("My Session");

  return (
    <div className="sessions-panel">
      <div className="sessions-header">
        <strong>Sessions</strong>
        <div className="sessions-save">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small" onClick={() => onSaveCurrentQueue(newName)}>Save Current Queue</button>
        </div>
      </div>

      <div className="sessions-list">
        {sessions.map((s) => (
          <div key={s.id} className="session-item">
            <div className="session-meta">
              <div className="session-title">{s.name}</div>
              <div className="session-sub">{s.mode} • {s.queue.length} tracks</div>
            </div>
            <div className="session-actions">
              <button className="btn small" onClick={() => onStartSession(s.id)}>Start Session</button>
              <button className="btn small" onClick={() => {
                const name = window.prompt("Rename session", s.name);
                if (name) onRenameSession(s.id, name);
              }}>Rename</button>
              <button className="btn small" onClick={() => onDuplicateSession(s.id)}>Duplicate</button>
              <button className="btn small" onClick={() => {
                if (window.confirm(`Delete session \"${s.name}\"?`)) onDeleteSession(s.id);
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
