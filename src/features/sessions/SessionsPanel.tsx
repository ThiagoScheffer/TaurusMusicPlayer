import { useState } from "react";
import type { Session } from "../../types/player";

interface SessionsPanelProps {
  sessions: Session[];
  onSaveCurrentQueue: (name: string) => void;
  onStartSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onAppendCurrentQueue: (sessionId: string) => void;
  onReplaceWithCurrentQueue: (sessionId: string) => void;
  onRemoveTrackFromSession: (sessionId: string, trackId: string) => void;
}

export function SessionsPanel({
  sessions,
  onSaveCurrentQueue,
  onStartSession,
  onRenameSession,
  onDuplicateSession,
  onDeleteSession,
  onAppendCurrentQueue,
  onReplaceWithCurrentQueue,
  onRemoveTrackFromSession,
}: SessionsPanelProps) {
  const [newName, setNewName] = useState("My Session");
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

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
        {sessions.map((s) => {
          const expanded = expandedSessionId === s.id;
          return (
            <div key={s.id} className="session-item">
              <div className="session-meta">
                <div className="session-title">{s.name}</div>
                <div className="session-sub">{s.mode} • {s.queue.length} tracks</div>
              </div>
              <div className="session-actions">
                <button className="btn small" onClick={() => setExpandedSessionId(expanded ? null : s.id)}>
                  {expanded ? "Hide Tracks" : "Show Tracks"}
                </button>
                <button className="btn small" onClick={() => onStartSession(s.id)}>Start Session</button>
                <button className="btn small" onClick={() => onAppendCurrentQueue(s.id)}>Append Queue</button>
                <button className="btn small" onClick={() => onReplaceWithCurrentQueue(s.id)}>Replace Queue</button>
                <button className="btn small" onClick={() => {
                  const name = window.prompt("Rename session", s.name);
                  if (name) onRenameSession(s.id, name);
                }}>Rename</button>
                <button className="btn small" onClick={() => onDuplicateSession(s.id)}>Duplicate</button>
                <button className="btn small" onClick={() => {
                  if (window.confirm(`Delete session "${s.name}"?`)) onDeleteSession(s.id);
                }}>Delete</button>
              </div>
              {expanded && (
                <div className="session-tracks">
                  {s.queue.length === 0 && <div className="queue-empty">Session has no saved tracks.</div>}
                  {s.queue.map((track) => (
                    <div key={track.id} className="queue-item">
                      <div className="queue-meta">
                        <div className="queue-title">{track.title || track.videoId || track.sourceUrl}</div>
                        <div className="queue-sub">{track.artist ? `${track.artist} • ` : ""}{track.videoId || track.sourceUrl}</div>
                      </div>
                      <button className="btn small" onClick={() => onRemoveTrackFromSession(s.id, track.id)}>
                        REMOVE
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
