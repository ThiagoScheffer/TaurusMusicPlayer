import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PLAYBACK_TOOL_EVENTS, RUNTIME_EVENTS } from "../../ipc/events";
import { emitToMain, listenTypedEvent, type PlaybackToolsStatus, type RuntimeCommand } from "../../ipc/player.contract";
import type { FocusMode, Session } from "../../types/player";
import type { RuntimeSnapshot } from "../../runtime/RuntimeSnapshot";
import { FocusModesPanel } from "../focus-modes/FocusModesPanel";
import { FocusTimerPanel } from "../focus-timer/FocusTimerPanel";
import { SessionsPanel } from "../sessions/SessionsPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { BlacklistEntryType } from "../../types/player";
import { confirmBackupReplace, openBackupFile, saveBackupFile } from "./backupFile";
import { parseBackupJson } from "./backup";

type Tab = "queue" | "sessions" | "focusTimer" | "focusModes" | "hotkeys" | "settings" | "blacklist";

const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  input: "",
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  isPlaying: false,
  volume: 70,
  muted: false,
  shuffle: false,
  repeat: "off",
  activeSessionId: null,
  activeFocusModeId: null,
  sessions: [],
  modes: [],
  focusTimer: {
    state: "idle",
    remainingSeconds: 25 * 60,
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
      rememberLastTrack: true,
      skipBlacklistedTracks: false,
      blacklistedVideoIds: [],
      blacklistEntries: [],
    },
  },
  settingsImportError: null,
};

const toCommand = (command: RuntimeCommand) =>
  emitToMain(RUNTIME_EVENTS.command, command).catch(() => {});

export function OptionsWindow() {
  const [tab, setTab] = useState<Tab>("queue");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(EMPTY_SNAPSHOT);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [playbackTools, setPlaybackTools] = useState<PlaybackToolsStatus | null>(null);
  const exportPendingRef = useRef(false);

  useEffect(() => {
    const unlistenSnapshotPromise = listenTypedEvent(RUNTIME_EVENTS.snapshot, (payload) => {
      setSnapshot(payload);
    });
    const unlistenExportPromise = listenTypedEvent(RUNTIME_EVENTS.settingsExport, (payload) => {
      if (!exportPendingRef.current) return;
      exportPendingRef.current = false;
      void saveBackupFile(payload.json).then((result) => {
        if (result.status === "completed") setBackupStatus("Backup exported successfully.");
        if (result.status === "cancelled") setBackupStatus("Backup export cancelled.");
        if (result.status === "error") setBackupStatus(`Backup export failed: ${result.error}`);
      });
    });
    const unlistenImportPromise = listenTypedEvent(RUNTIME_EVENTS.settingsImportResult, (payload) => {
      setBackupStatus(payload.ok ? "Backup imported successfully. Playback is stopped." : `Backup import failed: ${payload.error ?? "Unknown error."}`);
    });
    const unlistenToolsPromise = listenTypedEvent(PLAYBACK_TOOL_EVENTS.status, setPlaybackTools);

    emitToMain(RUNTIME_EVENTS.requestSnapshot).catch(() => {});
    invoke<PlaybackToolsStatus>("get_playback_tools_status").then(setPlaybackTools).catch(() => {});

    return () => {
      unlistenSnapshotPromise.then((fn) => fn()).catch(() => {});
      unlistenExportPromise.then((fn) => fn()).catch(() => {});
      unlistenImportPromise.then((fn) => fn()).catch(() => {});
      unlistenToolsPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const sessions: Session[] = snapshot.sessions;
  const modes: FocusMode[] = snapshot.modes;

  const tabs: Array<{ key: Tab; label: string }> = useMemo(
    () => [
      { key: "queue", label: `Queue (${snapshot.queue.length})` },
      { key: "sessions", label: "Sessions" },
      { key: "focusTimer", label: "Focus Timer" },
      { key: "focusModes", label: "Focus Modes" },
      { key: "hotkeys", label: "Hotkeys" },
      { key: "settings", label: "Settings" },
      { key: "blacklist", label: "Blacklist" },
    ],
    [snapshot.queue.length]
  );

  const exportBackup = () => {
    setBackupStatus("Preparing backup...");
    exportPendingRef.current = true;
    toCommand({ type: "settings.export-request" });
  };

  const importBackup = () => {
    void openBackupFile().then((result) => {
      if (result.status === "cancelled") {
        setBackupStatus("Backup import cancelled.");
        return;
      }
      if (result.status === "error" || !result.json) {
        setBackupStatus(`Backup import failed: ${result.status === "error" ? result.error : "No file contents found."}`);
        return;
      }
      const backupJson = result.json;
      const validation = parseBackupJson(backupJson);
      if (!validation.ok) {
        setBackupStatus(`Backup import failed: ${validation.error}`);
        return;
      }
      void confirmBackupReplace().then((confirmed) => {
        if (!confirmed) {
          setBackupStatus("Backup import cancelled.");
          return;
        }
        setBackupStatus("Importing backup...");
        toCommand({ type: "settings.import", json: backupJson });
      });
    });
  };

  return (
    <div className="options-app">
      <div className="options-sidebar">
        {tabs.map((t) => (
          <button key={t.key} className={`btn small nav-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="options-main">
        {tab === "queue" && (
          <div className="options-section queue-panel">
            <div className="queue-actions">
              <button className="btn small" onClick={() => toCommand({ type: "queue.dedup" })}>DEDUP</button>
              <button className="btn small" onClick={() => toCommand({ type: "queue.clear" })}>CLEAR</button>
            </div>
            {snapshot.queue.length === 0 && <div className="queue-empty">Queue is empty.</div>}
            {snapshot.queue.map((track, index) => (
              <div key={track.id} className={`queue-item ${index === snapshot.currentIndex ? "active" : ""}`}>
                <button className="queue-play" onClick={() => toCommand({ type: "queue.play-index", index })}>PLAY</button>
                <div className="queue-meta">
                  <div className="queue-title">{track.title}</div>
                  <div className="queue-sub">{track.videoId}</div>
                </div>
                <button className="btn small" onClick={() => toCommand({ type: "queue.remove-track", id: track.id })}>REMOVE</button>
              </div>
            ))}
          </div>
        )}

        {tab === "sessions" && (
          <SessionsPanel
            sessions={sessions}
            onSaveCurrentQueue={(name) => toCommand({ type: "session.save-current-queue", name })}
            onStartSession={(sessionId) => toCommand({ type: "session.start", sessionId })}
            onRenameSession={(sessionId, name) => toCommand({ type: "session.rename", sessionId, name })}
            onDuplicateSession={(sessionId) => toCommand({ type: "session.duplicate", sessionId })}
            onDeleteSession={(sessionId) => toCommand({ type: "session.delete", sessionId })}
            onAppendCurrentQueue={(sessionId) => toCommand({ type: "session.append-current-queue", sessionId })}
            onReplaceWithCurrentQueue={(sessionId) =>
              toCommand({ type: "session.replace-with-current-queue", sessionId })
            }
            onRemoveTrackFromSession={(sessionId, trackId) =>
              toCommand({ type: "session.remove-track", sessionId, trackId })
            }
          />
        )}

        {tab === "focusTimer" && (
          <FocusTimerPanel
            state={snapshot.focusTimer.state}
            remainingSeconds={snapshot.focusTimer.remainingSeconds}
            settings={snapshot.focusTimer.settings}
            setFocusMinutes={(minutes) => toCommand({ type: "focus-timer.set-focus-minutes", minutes })}
            setShortBreakMinutes={(minutes) => toCommand({ type: "focus-timer.set-short-break-minutes", minutes })}
            setLongBreakMinutes={(minutes) => toCommand({ type: "focus-timer.set-long-break-minutes", minutes })}
            setBreakBehavior={(behavior) => toCommand({ type: "focus-timer.set-break-behavior", behavior })}
            setBreakVolume={(volume) => toCommand({ type: "focus-timer.set-break-volume", volume })}
            start={() => toCommand({ type: "focus-timer.start" })}
            pauseTimer={() => toCommand({ type: "focus-timer.pause" })}
            resume={() => toCommand({ type: "focus-timer.resume" })}
            reset={() => toCommand({ type: "focus-timer.reset" })}
            skipPhase={() => toCommand({ type: "focus-timer.skip" })}
          />
        )}

        {tab === "focusModes" && (
          <FocusModesPanel
            modes={modes}
            sessions={sessions}
            activeModeId={snapshot.activeFocusModeId ?? ""}
            onSelectMode={(modeId) => toCommand({ type: "focus-mode.select", modeId })}
            onCreateMode={(name) => toCommand({ type: "focus-mode.create", name })}
            onEditMode={(modeId, update) => toCommand({ type: "focus-mode.edit", modeId, update })}
            onDeleteMode={(modeId) => toCommand({ type: "focus-mode.delete", modeId })}
          />
        )}

        {tab === "hotkeys" && (
          <div className="hotkeys-panel options-section">
            <strong>Hotkeys</strong>
            <div>Ctrl+Alt+P: Play/Pause</div>
            <div>Ctrl+Alt+N: Next Track</div>
            <div>Ctrl+Alt+B: Previous Track</div>
            <div>Ctrl+Alt+M: Mute/Unmute</div>
            <div>CapsLock is not supported as modifier.</div>
          </div>
        )}

        {tab === "settings" && (
          <SettingsPanel
            settings={snapshot.settings}
            setPlayback={(patch) => toCommand({ type: "settings.update-playback", patch })}
            hotkeys={[
              "Ctrl+Alt+P - Play/Pause",
              "Ctrl+Alt+N - Next Track",
              "Ctrl+Alt+B - Previous Track",
              "Ctrl+Alt+M - Mute/Unmute",
            ]}
            focusTimer={{
              focusMinutes: snapshot.focusTimer.settings.focusMinutes,
              shortBreakMinutes: snapshot.focusTimer.settings.shortBreakMinutes,
              longBreakMinutes: snapshot.focusTimer.settings.longBreakMinutes,
              breakBehavior: snapshot.focusTimer.settings.breakBehavior,
            }}
            setFocusMinutes={(minutes) => toCommand({ type: "focus-timer.set-focus-minutes", minutes })}
            setShortBreakMinutes={(minutes) => toCommand({ type: "focus-timer.set-short-break-minutes", minutes })}
            setLongBreakMinutes={(minutes) => toCommand({ type: "focus-timer.set-long-break-minutes", minutes })}
            setBreakBehavior={(behavior) => toCommand({ type: "focus-timer.set-break-behavior", behavior })}
            exportBackup={exportBackup}
            importBackup={importBackup}
            resetAllData={() => {
              toCommand({ type: "settings.reset" });
              return true;
            }}
            importError={snapshot.settingsImportError}
            backupStatus={backupStatus}
            playbackTools={playbackTools}
            checkPlaybackTools={() => {
              setPlaybackTools((current) => current ? { ...current, phase: "checking", message: "Checking GitHub for stable updates..." } : current);
              void invoke("check_playback_tools_updates").catch((error) => {
                setPlaybackTools((current) => current ? { ...current, phase: "failed", message: String(error) } : current);
              });
            }}
          />
        )}

        {tab === "blacklist" && (
          <div className="settings-panel options-section">
            <strong>Blacklist</strong>
            <BlacklistPanel snapshot={snapshot} />
          </div>
        )}
      </div>
    </div>
  );
}

function BlacklistPanel({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const [entryType, setEntryType] = useState<BlacklistEntryType>("video");
  const [entryValue, setEntryValue] = useState("");
  const entries = snapshot.settings.playback.blacklistEntries;

  const addEntry = () => {
    const value = entryValue.trim();
    if (!value) return;
    toCommand({
      type: "settings.update-playback",
      patch: {
        blacklistEntries: [
          ...entries,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: entryType,
            value,
            createdAt: Date.now(),
          },
        ],
      },
    });
    setEntryValue("");
  };

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <select value={entryType} onChange={(e) => setEntryType(e.target.value as BlacklistEntryType)}>
          <option value="video">Video ID / Link</option>
          <option value="category">Music Category/Type</option>
          <option value="genre">Genre</option>
          <option value="keyword">Keyword</option>
        </select>
        <input value={entryValue} onChange={(e) => setEntryValue(e.target.value)} placeholder="Blacklist value" />
        <button className="btn small" onClick={addEntry}>ADD</button>
      </div>
      {entries.length === 0 && <div className="queue-empty">No blacklist entries.</div>}
      {entries.map((entry) => (
        <div key={entry.id} className="queue-item">
          <div className="queue-meta">
            <div className="queue-title">{entry.value}</div>
            <div className="queue-sub">{entry.type}</div>
          </div>
          <button
            className="btn small"
            onClick={() =>
              toCommand({
                type: "settings.update-playback",
                patch: {
                  blacklistEntries: entries.filter((item) => item.id !== entry.id),
                },
              })
            }
          >
            RESTORE
          </button>
        </div>
      ))}
    </>
  );
}
