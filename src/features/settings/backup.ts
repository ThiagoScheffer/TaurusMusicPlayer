import type { FocusTimerSettings } from "../focus-timer/useFocusTimer";
import type { FocusMode, Session, Track } from "../../types/player";
import type { RuntimeSnapshot } from "../../runtime/RuntimeSnapshot";
import type { AppSettings } from "./useAppSettings";

export const BACKUP_FORMAT = "taurus-music-player-backup";
export const BACKUP_VERSION = 2;

export interface TaurusBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  player: {
    input: string;
    queue: Track[];
    currentIndex: number;
    volume: number;
    muted: boolean;
  };
  settings: AppSettings;
  sessions: Session[];
  focusTimerSettings: FocusTimerSettings;
  focusModes: {
    modes: FocusMode[];
    activeModeId: string | null;
  };
}

export type BackupParseResult = { ok: true; backup: TaurusBackup } | { ok: false; error: string };

const DEFAULT_SETTINGS: AppSettings = {
  playback: {
    defaultVolume: 70,
    autoplayNext: true,
    rememberLastTrack: true,
    skipBlacklistedTracks: false,
    blacklistedVideoIds: [],
    blacklistEntries: [],
  },
};

const DEFAULT_TIMER_SETTINGS: FocusTimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  breakBehavior: "continue",
  breakVolume: 35,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.artist === undefined || typeof value.artist === "string") &&
    value.sourceType === "youtube" &&
    typeof value.sourceUrl === "string" &&
    typeof value.videoId === "string" &&
    (value.duration === undefined || typeof value.duration === "number") &&
    typeof value.addedAt === "number"
  );
}

function isSettings(value: unknown): value is AppSettings {
  if (!isRecord(value) || !isRecord(value.playback)) return false;
  const playback = value.playback;
  return (
    typeof playback.defaultVolume === "number" &&
    typeof playback.autoplayNext === "boolean" &&
    typeof playback.rememberLastTrack === "boolean" &&
    typeof playback.skipBlacklistedTracks === "boolean" &&
    Array.isArray(playback.blacklistedVideoIds) &&
    playback.blacklistedVideoIds.every((item) => typeof item === "string") &&
    Array.isArray(playback.blacklistEntries) &&
    playback.blacklistEntries.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        (item.type === "video" || item.type === "category" || item.type === "genre" || item.type === "keyword") &&
        typeof item.value === "string" &&
        typeof item.createdAt === "number"
    )
  );
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.mode === "coding" || value.mode === "study" || value.mode === "reading" || value.mode === "deep-work" || value.mode === "night" || value.mode === "custom") &&
    Array.isArray(value.queue) &&
    value.queue.every(isTrack) &&
    typeof value.volume === "number" &&
    typeof value.muted === "boolean" &&
    typeof value.shuffle === "boolean" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function isFocusMode(value: unknown): value is FocusMode {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    typeof value.defaultVolume === "number" &&
    (value.preferredSessionId === undefined || typeof value.preferredSessionId === "string") &&
    typeof value.shuffle === "boolean" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    (value.themeIntensity === "calm" || value.themeIntensity === "neutral" || value.themeIntensity === "intense")
  );
}

function isFocusTimerSettings(value: unknown): value is FocusTimerSettings {
  if (!isRecord(value)) return false;
  return (
    typeof value.focusMinutes === "number" && value.focusMinutes > 0 &&
    typeof value.shortBreakMinutes === "number" && value.shortBreakMinutes > 0 &&
    typeof value.longBreakMinutes === "number" && value.longBreakMinutes > 0 &&
    (value.breakBehavior === "continue" || value.breakBehavior === "pause" || value.breakBehavior === "lowerVolume") &&
    typeof value.breakVolume === "number" && value.breakVolume >= 0 && value.breakVolume <= 100
  );
}

function validateBackup(value: unknown): BackupParseResult {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    return { ok: false, error: "This is not a supported Taurus Music Player backup." };
  }
  if (typeof value.exportedAt !== "number" || !isRecord(value.player) || !isSettings(value.settings)) {
    return { ok: false, error: "Backup metadata or settings are invalid." };
  }
  const player = value.player;
  if (
    typeof player.input !== "string" ||
    !Array.isArray(player.queue) ||
    !player.queue.every(isTrack) ||
    typeof player.currentIndex !== "number" ||
    !Number.isInteger(player.currentIndex) ||
    player.currentIndex < -1 ||
    player.currentIndex >= player.queue.length ||
    typeof player.volume !== "number" ||
    player.volume < 0 ||
    player.volume > 100 ||
    typeof player.muted !== "boolean"
  ) {
    return { ok: false, error: "Backup player data is invalid." };
  }
  if (!Array.isArray(value.sessions) || !value.sessions.every(isSession) || !isFocusTimerSettings(value.focusTimerSettings)) {
    return { ok: false, error: "Backup sessions or focus timer settings are invalid." };
  }
  if (!isRecord(value.focusModes) || !Array.isArray(value.focusModes.modes) || !value.focusModes.modes.every(isFocusMode)) {
    return { ok: false, error: "Backup focus modes are invalid." };
  }
  if (value.focusModes.activeModeId !== null && typeof value.focusModes.activeModeId !== "string") {
    return { ok: false, error: "Backup active focus mode is invalid." };
  }

  return { ok: true, backup: value as unknown as TaurusBackup };
}

function parseLegacyBackup(value: Record<string, unknown>): BackupParseResult {
  if (value.version !== 1 || !isRecord(value.taurusData)) {
    return { ok: false, error: "This backup format is not supported." };
  }
  const data = value.taurusData;
  const parseEntry = (key: string, fallback: unknown) => {
    const raw = data[key];
    if (typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return fallback;
    }
  };
  const queue = parseEntry("taurus.queue", []);
  const sessions = parseEntry("taurus.sessions", []);
  const settings = parseEntry("taurus.appSettings", DEFAULT_SETTINGS);
  const timer = parseEntry("taurus.focusTimer.settings", DEFAULT_TIMER_SETTINGS);
  const modes = parseEntry("taurus.focusModes", []);
  const currentIndex = Number(data["taurus.currentIndex"] ?? -1);
  const volume = Number(data["taurus.volume"] ?? DEFAULT_SETTINGS.playback.defaultVolume);
  const muted = data["taurus.muted"] === "true";
  const input = typeof data["taurus.input"] === "string" ? data["taurus.input"] : "";

  return validateBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
    player: { input, queue, currentIndex, volume, muted },
    settings,
    sessions,
    focusTimerSettings: timer,
    focusModes: { modes, activeModeId: data["taurus.focusModes.activeId"] ?? null },
  });
}

export function createBackup(snapshot: RuntimeSnapshot): TaurusBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    player: {
      input: snapshot.input,
      queue: snapshot.queue.map((track) => ({ ...track })),
      currentIndex: snapshot.currentIndex,
      volume: snapshot.volume,
      muted: snapshot.muted,
    },
    settings: structuredClone(snapshot.settings),
    sessions: structuredClone(snapshot.sessions),
    focusTimerSettings: { ...snapshot.focusTimer.settings },
    focusModes: {
      modes: structuredClone(snapshot.modes),
      activeModeId: snapshot.activeFocusModeId,
    },
  };
}

export function createBackupJson(snapshot: RuntimeSnapshot): string {
  return JSON.stringify(createBackup(snapshot), null, 2);
}

export function parseBackupJson(json: string): BackupParseResult {
  try {
    const value = JSON.parse(json) as unknown;
    if (isRecord(value) && value.version === 1) return parseLegacyBackup(value);
    return validateBackup(value);
  } catch {
    return { ok: false, error: "Backup file contains invalid JSON." };
  }
}

export function backupFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
  return `taurus-music-player-backup-${stamp}.json`;
}
