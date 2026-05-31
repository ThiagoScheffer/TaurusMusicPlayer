import { useEffect, useMemo, useState } from "react";
import { RUNTIME_EVENTS } from "../../ipc/events";
import { emitToMain, listenTypedEvent, type RuntimeCommand } from "../../ipc/player.contract";
import type { FocusMode, Session } from "../../types/player";
import type { RuntimeSnapshot } from "../../runtime/RuntimeSnapshot";
import { FocusModesPanel } from "../focus-modes/FocusModesPanel";
import { FocusTimerPanel } from "../focus-timer/FocusTimerPanel";
import { SessionsPanel } from "../sessions/SessionsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { useAppSettings } from "./useAppSettings";

type Tab = "queue" | "sessions" | "focusTimer" | "focusModes" | "hotkeys" | "settings" | "blacklist";

const EMPTY_SNAPSHOT: RuntimeSnapshot = {
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
    },
  },
};

const toCommand = (command: RuntimeCommand) =>
  emitToMain(RUNTIME_EVENTS.command, command).catch(() => {});

export function OptionsWindow() {
  const [tab, setTab] = useState<Tab>("queue");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(EMPTY_SNAPSHOT);
  const appSettings = useAppSettings();

  useEffect(() => {
    const unlistenPromise = listenTypedEvent(RUNTIME_EVENTS.snapshot, (payload) => {
      setSnapshot(payload);
    });

    emitToMain(RUNTIME_EVENTS.requestSnapshot).catch(() => {});

    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
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
            settings={appSettings.settings}
            setPlayback={appSettings.setPlayback}
            hotkeys={appSettings.hotkeys}
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
            exportData={appSettings.exportData}
            importData={appSettings.importData}
            resetAllData={appSettings.resetAllData}
            importError={appSettings.importError}
          />
        )}

        {tab === "blacklist" && (
          <div className="settings-panel options-section">
            <strong>Blacklist</strong>
            {appSettings.settings.playback.blacklistedVideoIds.length === 0 && <div className="queue-empty">No blacklisted tracks.</div>}
            {appSettings.settings.playback.blacklistedVideoIds.map((id) => (
              <div key={id} className="queue-item">
                <div className="queue-meta"><div className="queue-title">{id}</div></div>
                <button
                  className="btn small"
                  onClick={() =>
                    appSettings.setPlayback({
                      blacklistedVideoIds: appSettings.settings.playback.blacklistedVideoIds.filter((v) => v !== id),
                    })
                  }
                >
                  RESTORE
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

