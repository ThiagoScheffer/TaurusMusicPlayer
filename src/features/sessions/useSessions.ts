import { useEffect, useState } from "react";
import type { Session, Track } from "../../types/player";

const SESSIONS_KEY = "taurus.sessions";

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneQueue(queue: Track[]): Track[] {
  return queue.map((t) => ({ ...t }));
}

function createTemplate(name: string, mode: Session["mode"]): Session {
  const now = Date.now();
  return {
    id: nowId(),
    name,
    mode,
    queue: [],
    volume: 70,
    muted: false,
    shuffle: false,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultTemplates(): Session[] {
  return [
    createTemplate("Deep Focus", "deep-work"),
    createTemplate("Coding Flow", "coding"),
    createTemplate("Calm Study", "study"),
    createTemplate("Night Coding", "night"),
  ];
}

function readSessions(): Session[] {
  const raw = localStorage.getItem(SESSIONS_KEY);
  if (!raw) return defaultTemplates();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultTemplates();
    const valid = parsed.filter((item): item is Session => {
      if (!item || typeof item !== "object") return false;
      const s = item as Partial<Session>;
      return (
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        Array.isArray(s.queue) &&
        typeof s.volume === "number" &&
        typeof s.muted === "boolean" &&
        typeof s.shuffle === "boolean" &&
        typeof s.createdAt === "number" &&
        typeof s.updatedAt === "number"
      );
    });

    if (valid.length === 0) return defaultTemplates();

    const names = new Set(valid.map((s) => s.name));
    const templatesToAdd = defaultTemplates().filter((t) => !names.has(t.name));
    return [...valid, ...templatesToAdd];
  } catch {
    return defaultTemplates();
  }
}

interface UseSessionsArgs {
  queue: Track[];
  volume: number;
  muted: boolean;
  startSessionInPlayer: (session: Session) => void;
}

export function useSessions({ queue, volume, muted, startSessionInPlayer }: UseSessionsArgs) {
  const [sessions, setSessions] = useState<Session[]>(readSessions);

  useEffect(() => {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const saveCurrentQueueAsSession = (name: string, mode: Session["mode"] = "custom", description?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const now = Date.now();
    const session: Session = {
      id: nowId(),
      name: trimmed,
      description,
      mode,
      queue: cloneQueue(queue),
      volume,
      muted,
      shuffle: false,
      createdAt: now,
      updatedAt: now,
    };

    setSessions((prev) => [session, ...prev]);
  };

  const startSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    startSessionInPlayer(session);
  };

  const getSessionById = (sessionId: string) => sessions.find((s) => s.id === sessionId);

  const renameSession = (sessionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, name: trimmed, updatedAt: Date.now() } : s))
    );
  };

  const duplicateSession = (sessionId: string) => {
    const source = sessions.find((s) => s.id === sessionId);
    if (!source) return;

    const now = Date.now();
    const copy: Session = {
      ...source,
      id: nowId(),
      name: `${source.name} Copy`,
      queue: cloneQueue(source.queue),
      createdAt: now,
      updatedAt: now,
    };

    setSessions((prev) => [copy, ...prev]);
  };

  const deleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  return {
    sessions,
    saveCurrentQueueAsSession,
    startSession,
    getSessionById,
    renameSession,
    duplicateSession,
    deleteSession,
  };
}
