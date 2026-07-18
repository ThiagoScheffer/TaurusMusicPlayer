import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_VERSION, createBackup, parseBackupJson } from "./backup";
import type { RuntimeSnapshot } from "../../runtime/RuntimeSnapshot";

const track = {
  id: "track-1",
  title: "Focus Track",
  sourceType: "youtube" as const,
  sourceUrl: "https://www.youtube.com/watch?v=abc123",
  videoId: "abc123",
  addedAt: 1,
};

function createSnapshot(): RuntimeSnapshot {
  return {
    input: track.sourceUrl,
    queue: [track],
    currentIndex: 0,
    currentTrack: track,
    isPlaying: true,
    volume: 64,
    muted: false,
    shuffle: false,
    repeat: "off",
    activeSessionId: null,
    activeFocusModeId: null,
    sessions: [],
    modes: [],
    focusTimer: {
      state: "idle",
      remainingSeconds: 1500,
      settings: {
        focusMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        breakBehavior: "continue",
        breakVolume: 35,
      },
    },
    settings: {
      playback: {
        defaultVolume: 70,
        autoplayNext: true,
        rememberLastTrack: false,
        skipBlacklistedTracks: false,
        blacklistedVideoIds: [],
        blacklistEntries: [],
      },
    },
    settingsImportError: null,
  };
}

describe("Taurus backup format", () => {
  it("exports the live queue even when rememberLastTrack is disabled", () => {
    const backup = createBackup(createSnapshot());

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.player.queue).toEqual([track]);
    expect(backup.settings.playback.rememberLastTrack).toBe(false);
  });

  it("parses a valid version-2 backup", () => {
    const result = parseBackupJson(JSON.stringify(createBackup(createSnapshot())));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup.player.currentIndex).toBe(0);
  });

  it("imports the legacy version-1 localStorage envelope", () => {
    const legacy = {
      version: 1,
      exportedAt: 1,
      taurusData: {
        "taurus.input": track.sourceUrl,
        "taurus.queue": JSON.stringify([track]),
        "taurus.currentIndex": "0",
        "taurus.volume": "64",
        "taurus.muted": "false",
        "taurus.appSettings": JSON.stringify(createSnapshot().settings),
        "taurus.sessions": "[]",
        "taurus.focusTimer.settings": JSON.stringify(createSnapshot().focusTimer.settings),
        "taurus.focusModes": "[]",
      },
    };

    const result = parseBackupJson(JSON.stringify(legacy));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup.player.queue[0]?.videoId).toBe("abc123");
  });

  it("rejects malformed backup data", () => {
    expect(parseBackupJson("not json")).toEqual({ ok: false, error: "Backup file contains invalid JSON." });
    expect(parseBackupJson(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toEqual({
      ok: false,
      error: "Backup metadata or settings are invalid.",
    });
  });
});
