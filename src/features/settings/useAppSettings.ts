import { useEffect, useMemo, useState } from "react";

export interface AppSettings {
  playback: {
    defaultVolume: number;
    autoplayNext: boolean;
    rememberLastTrack: boolean;
    skipBlacklistedTracks: boolean;
    blacklistedVideoIds: string[];
  };
}

const SETTINGS_KEY = "taurus.appSettings";

const DEFAULT_SETTINGS: AppSettings = {
  playback: {
    defaultVolume: 70,
    autoplayNext: true,
    rememberLastTrack: true,
    skipBlacklistedTracks: false,
    blacklistedVideoIds: [],
  },
};

function readSettings(): AppSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const playback: Partial<AppSettings["playback"]> = parsed.playback ?? {};
    return {
      playback: {
        defaultVolume:
          typeof playback.defaultVolume === "number"
            ? Math.min(100, Math.max(0, playback.defaultVolume))
            : DEFAULT_SETTINGS.playback.defaultVolume,
        autoplayNext:
          typeof playback.autoplayNext === "boolean"
            ? playback.autoplayNext
            : DEFAULT_SETTINGS.playback.autoplayNext,
        rememberLastTrack:
          typeof playback.rememberLastTrack === "boolean"
            ? playback.rememberLastTrack
            : DEFAULT_SETTINGS.playback.rememberLastTrack,
        skipBlacklistedTracks:
          typeof playback.skipBlacklistedTracks === "boolean"
            ? playback.skipBlacklistedTracks
            : DEFAULT_SETTINGS.playback.skipBlacklistedTracks,
        blacklistedVideoIds: Array.isArray(playback.blacklistedVideoIds)
          ? playback.blacklistedVideoIds.filter((v: unknown): v is string => typeof v === "string")
          : DEFAULT_SETTINGS.playback.blacklistedVideoIds,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function collectTaurusData(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("taurus.")) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(readSettings);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("taurus.")) {
        setSettings(readSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const updateSettings = (next: AppSettings) => {
    setSettings(next);
    writeSettings(next);
  };

  const setPlayback = (patch: Partial<AppSettings["playback"]>) => {
    updateSettings({
      ...settings,
      playback: {
        ...settings.playback,
        ...patch,
      },
    });
  };

  const exportData = () => {
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      taurusData: collectTaurusData(),
    };
    return JSON.stringify(payload, null, 2);
  };

  const importData = (json: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Import must be a JSON object.");
      }

      const taurusData = (parsed as { taurusData?: unknown }).taurusData;
      if (!taurusData || typeof taurusData !== "object" || Array.isArray(taurusData)) {
        throw new Error("Import JSON must include a 'taurusData' object.");
      }

      const entries = Object.entries(taurusData as Record<string, unknown>);
      for (const [key, value] of entries) {
        if (!key.startsWith("taurus.")) continue;
        if (typeof value !== "string") {
          throw new Error(`Invalid value for key '${key}'. Expected string.`);
        }
      }

      for (const [key, value] of entries) {
        if (!key.startsWith("taurus.")) continue;
        localStorage.setItem(key, value as string);
      }

      const refreshed = readSettings();
      setSettings(refreshed);
      setImportError(null);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON import.";
      setImportError(message);
      return { ok: false, error: message };
    }
  };

  const resetAllData = (): boolean => {
    const ok = window.confirm("Reset all Taurus app data? This cannot be undone.");
    if (!ok) return false;

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("taurus.")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);

    const fresh = readSettings();
    setSettings(fresh);
    setImportError(null);
    return true;
  };

  return {
    settings,
    setPlayback,
    exportData,
    importData,
    resetAllData,
    importError,
    hotkeys: useMemo(
      () => [
        "Ctrl+Alt+P - Play/Pause",
        "Ctrl+Alt+N - Next Track",
        "Ctrl+Alt+B - Previous Track",
        "Ctrl+Alt+M - Mute/Unmute",
      ],
      []
    ),
  };
}
