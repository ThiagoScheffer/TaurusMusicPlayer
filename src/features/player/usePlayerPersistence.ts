import { useEffect } from "react";
import type { Track } from "../../types/player";

export const DEFAULT_URL = "https://www.youtube.com/watch?v=0psoEvF8XIk";

export const PLAYER_STORAGE_KEYS = {
  volume: "taurus.volume",
  muted: "taurus.muted",
  input: "taurus.input",
  queue: "taurus.queue",
  currentIndex: "taurus.currentIndex",
} as const;

function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function readString(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

export function readPersistedQueue(): Track[] {
  const raw = localStorage.getItem(PLAYER_STORAGE_KEYS.queue);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is Track => {
      if (!item || typeof item !== "object") return false;
      const t = item as Partial<Track>;
      return (
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        t.sourceType === "youtube" &&
        typeof t.sourceUrl === "string" &&
        typeof t.videoId === "string" &&
        typeof t.addedAt === "number"
      );
    });
  } catch {
    return [];
  }
}

export function readPersistedPlayerInit(config: {
  defaultVolume: number;
  rememberLastTrack: boolean;
}) {
  const storedInput = readString(PLAYER_STORAGE_KEYS.input, DEFAULT_URL);
  const initialQueue = config.rememberLastTrack ? readPersistedQueue() : [];
  const initialIndex = config.rememberLastTrack
    ? Math.max(
        -1,
        Math.min(
          readNumber(PLAYER_STORAGE_KEYS.currentIndex, initialQueue.length > 0 ? 0 : -1),
          initialQueue.length - 1
        )
      )
    : -1;

  return {
    storedInput,
    initialQueue,
    initialIndex,
    initialVolume: readNumber(PLAYER_STORAGE_KEYS.volume, config.defaultVolume),
    initialMuted: readBoolean(PLAYER_STORAGE_KEYS.muted, false),
  };
}

export function usePlayerPersistence(params: {
  volume: number;
  muted: boolean;
  input: string;
  queue: Track[];
  currentIndex: number;
  rememberLastTrack: boolean;
}) {
  const { volume, muted, input, queue, currentIndex, rememberLastTrack } = params;

  useEffect(() => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.volume, String(volume));
  }, [volume]);

  useEffect(() => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.muted, String(muted));
  }, [muted]);

  useEffect(() => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.input, input);
  }, [input]);

  useEffect(() => {
    if (rememberLastTrack) {
      localStorage.setItem(PLAYER_STORAGE_KEYS.queue, JSON.stringify(queue));
    }
  }, [queue, rememberLastTrack]);

  useEffect(() => {
    if (rememberLastTrack) {
      localStorage.setItem(PLAYER_STORAGE_KEYS.currentIndex, String(currentIndex));
    }
  }, [currentIndex, rememberLastTrack]);

  useEffect(() => {
    if (!rememberLastTrack) {
      localStorage.removeItem(PLAYER_STORAGE_KEYS.queue);
      localStorage.removeItem(PLAYER_STORAGE_KEYS.currentIndex);
    }
  }, [rememberLastTrack]);
}

