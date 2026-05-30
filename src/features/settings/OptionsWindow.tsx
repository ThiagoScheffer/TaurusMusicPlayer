import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { Track } from "../../types/player";
import { FocusModesPanel } from "../focus-modes/FocusModesPanel";
import { useFocusModes } from "../focus-modes/useFocusModes";
import { FocusTimerPanel } from "../focus-timer/FocusTimerPanel";
import { useFocusTimer } from "../focus-timer/useFocusTimer";
import { SessionsPanel } from "../sessions/SessionsPanel";
import { useSessions } from "../sessions/useSessions";
import { SettingsPanel } from "./SettingsPanel";
import { useAppSettings } from "./useAppSettings";

type Tab = "queue" | "sessions" | "focusTimer" | "focusModes" | "hotkeys" | "settings" | "blacklist";

interface PlayerSnapshot {
  queue: Track[];
  currentIndex: number;
}

export function OptionsWindow() {
  const [tab, setTab] = useState<Tab>("queue");
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>({ queue: [], currentIndex: -1 });
  const appSettings = useAppSettings();

  const focusTimer = useFocusTimer({
    isPlaying: false,
    volume: appSettings.settings.playback.defaultVolume,
    play: () => {},
    pause: () => {},
    setVolume: () => {},
  });

  const {
    sessions,
    saveCurrentQueueAsSession,
    startSession: _unusedStartSession,
    renameSession,
    duplicateSession,
    deleteSession,
  } = useSessions({
    queue: snapshot.queue,
    volume: appSettings.settings.playback.defaultVolume,
    muted: false,
    startSessionInPlayer: () => {},
  });

  const { modes, activeModeId, selectMode, createMode, editMode, deleteMode } = useFocusModes({
    sessions,
    setVolume: (v) => appSettings.setPlayback({ defaultVolume: v }),
    startSessionById: (sessionId) => {
      emitMain("player://start-session", { sessionId });
    },
  });

  useEffect(() => {
    const unlistenPromise = listen<{ queue: Track[]; currentIndex: number }>("player://state", (event) => {
      setSnapshot({ queue: event.payload.queue ?? [], currentIndex: event.payload.currentIndex ?? -1 });
    });

    emitMain("player://request-state", {});

    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "queue", label: `Queue (${snapshot.queue.length})` },
    { key: "sessions", label: "Sessions" },
    { key: "focusTimer", label: "Focus Timer" },
    { key: "focusModes", label: "Focus Modes" },
    { key: "hotkeys", label: "Hotkeys" },
    { key: "settings", label: "Settings" },
    { key: "blacklist", label: "Blacklist" },
  ];

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
              <button className="btn small" onClick={() => emitMain("player://dedup-queue", {})}>DEDUP</button>
              <button className="btn small" onClick={() => emitMain("player://clear-queue", {})}>CLEAR</button>
            </div>
            {snapshot.queue.length === 0 && <div className="queue-empty">Queue is empty.</div>}
            {snapshot.queue.map((track, index) => (
              <div key={track.id} className={`queue-item ${index === snapshot.currentIndex ? "active" : ""}`}>
                <button className="queue-play" onClick={() => emitMain("player://play-index", { index })}>PLAY</button>
                <div className="queue-meta">
                  <div className="queue-title">{track.title}</div>
                  <div className="queue-sub">{track.videoId}</div>
                </div>
                <button className="btn small" onClick={() => emitMain("player://remove-track", { id: track.id })}>REMOVE</button>
              </div>
            ))}
          </div>
        )}

        {tab === "sessions" && (
          <SessionsPanel
            sessions={sessions}
            onSaveCurrentQueue={saveCurrentQueueAsSession}
            onStartSession={(id) => emitMain("player://start-session", { sessionId: id })}
            onRenameSession={renameSession}
            onDuplicateSession={duplicateSession}
            onDeleteSession={deleteSession}
          />
        )}

        {tab === "focusTimer" && (
          <FocusTimerPanel
            state={focusTimer.state}
            remainingSeconds={focusTimer.remainingSeconds}
            settings={focusTimer.settings}
            setFocusMinutes={focusTimer.setFocusMinutes}
            setShortBreakMinutes={focusTimer.setShortBreakMinutes}
            setLongBreakMinutes={focusTimer.setLongBreakMinutes}
            setBreakBehavior={focusTimer.setBreakBehavior}
            setBreakVolume={focusTimer.setBreakVolume}
            start={focusTimer.start}
            pauseTimer={focusTimer.pauseTimer}
            resume={focusTimer.resume}
            reset={focusTimer.reset}
            skipPhase={focusTimer.skipPhase}
          />
        )}

        {tab === "focusModes" && (
          <FocusModesPanel
            modes={modes}
            sessions={sessions}
            activeModeId={activeModeId}
            onSelectMode={(id) => {
              selectMode(id);
              emitMain("player://set-focus-mode", { modeId: id });
            }}
            onCreateMode={createMode}
            onEditMode={editMode}
            onDeleteMode={deleteMode}
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
              focusMinutes: focusTimer.settings.focusMinutes,
              shortBreakMinutes: focusTimer.settings.shortBreakMinutes,
              longBreakMinutes: focusTimer.settings.longBreakMinutes,
              breakBehavior: focusTimer.settings.breakBehavior,
            }}
            setFocusMinutes={focusTimer.setFocusMinutes}
            setShortBreakMinutes={focusTimer.setShortBreakMinutes}
            setLongBreakMinutes={focusTimer.setLongBreakMinutes}
            setBreakBehavior={focusTimer.setBreakBehavior}
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
  const emitMain = <T,>(event: string, payload?: T) =>
    emitTo("main", event, payload).catch(() => {});
