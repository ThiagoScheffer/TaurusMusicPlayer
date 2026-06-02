import { useEffect, useMemo, useRef } from "react";
import { RUNTIME_EVENTS } from "../ipc/events";
import { emitToOptions, listenTypedEvent, type RuntimeCommand } from "../ipc/player.contract";
import type { RuntimeSnapshot } from "./RuntimeSnapshot";
import type { usePlayer } from "../features/player/usePlayer";
import type { useSessions } from "../features/sessions/useSessions";
import type { useFocusModes } from "../features/focus-modes/useFocusModes";
import type { useFocusTimer } from "../features/focus-timer/useFocusTimer";
import type { useAppSettings } from "../features/settings/useAppSettings";

export type RuntimeControllerDeps = {
  player: ReturnType<typeof usePlayer>;
  sessions: ReturnType<typeof useSessions>;
  focusModes: ReturnType<typeof useFocusModes>;
  focusTimer: ReturnType<typeof useFocusTimer>;
  appSettings: ReturnType<typeof useAppSettings>;
  activeSessionId: string | null;
  applySession: (sessionId: string) => void;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
};

function buildSnapshot(deps: RuntimeControllerDeps): RuntimeSnapshot {
  const { player, sessions, focusModes, focusTimer, appSettings, activeSessionId, shuffle, repeat } = deps;
  return {
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrack: player.currentTrack,
    isPlaying: player.isPlaying,
    volume: player.volume,
    muted: player.muted,
    shuffle,
    repeat,
    activeSessionId,
    activeFocusModeId: focusModes.activeModeId || null,
    sessions: sessions.sessions,
    modes: focusModes.modes,
    focusTimer: {
      state: focusTimer.state,
      remainingSeconds: focusTimer.remainingSeconds,
      settings: focusTimer.settings,
    },
    settings: appSettings.settings,
    settingsImportError: appSettings.importError,
  };
}

function handleRuntimeCommand(command: RuntimeCommand, deps: RuntimeControllerDeps) {
  const { player, sessions, focusModes, focusTimer, applySession, appSettings } = deps;
  switch (command.type) {
    case "queue.play-index":
      player.playTrackImmediately(command.index);
      break;
    case "queue.remove-track":
      player.removeFromQueue(command.id);
      break;
    case "queue.clear":
      player.clearQueue();
      break;
    case "queue.dedup":
      player.removeDuplicates();
      break;
    case "session.save-current-queue":
      sessions.saveCurrentQueueAsSession(command.name);
      break;
    case "session.start":
      applySession(command.sessionId);
      break;
    case "session.append-current-queue":
      sessions.appendCurrentQueueToSession(command.sessionId);
      break;
    case "session.replace-with-current-queue":
      sessions.replaceSessionQueueWithCurrent(command.sessionId);
      break;
    case "session.remove-track":
      sessions.removeTrackFromSession(command.sessionId, command.trackId);
      break;
    case "session.rename":
      sessions.renameSession(command.sessionId, command.name);
      break;
    case "session.duplicate":
      sessions.duplicateSession(command.sessionId);
      break;
    case "session.delete":
      sessions.deleteSession(command.sessionId);
      break;
    case "focus-mode.select":
      focusModes.selectMode(command.modeId);
      break;
    case "focus-mode.create":
      focusModes.createMode(command.name);
      break;
    case "focus-mode.edit":
      focusModes.editMode(command.modeId, command.update);
      break;
    case "focus-mode.delete":
      focusModes.deleteMode(command.modeId);
      break;
    case "focus-timer.start":
      focusTimer.start();
      break;
    case "focus-timer.pause":
      focusTimer.pauseTimer();
      break;
    case "focus-timer.resume":
      focusTimer.resume();
      break;
    case "focus-timer.reset":
      focusTimer.reset();
      break;
    case "focus-timer.skip":
      focusTimer.skipPhase();
      break;
    case "focus-timer.set-focus-minutes":
      focusTimer.setFocusMinutes(command.minutes);
      break;
    case "focus-timer.set-short-break-minutes":
      focusTimer.setShortBreakMinutes(command.minutes);
      break;
    case "focus-timer.set-long-break-minutes":
      focusTimer.setLongBreakMinutes(command.minutes);
      break;
    case "focus-timer.set-break-behavior":
      focusTimer.setBreakBehavior(command.behavior);
      break;
    case "focus-timer.set-break-volume":
      focusTimer.setBreakVolume(command.volume);
      break;
    case "settings.update-playback":
      appSettings.setPlayback(command.patch);
      break;
    case "settings.import":
      appSettings.importData(command.json);
      break;
    case "settings.reset":
      appSettings.resetAllData();
      break;
    case "settings.export-request":
      emitToOptions(RUNTIME_EVENTS.settingsExport, { json: appSettings.exportData() }).catch(() => {});
      break;
    default:
      break;
  }
}

export function useRuntimeController(deps: RuntimeControllerDeps) {
  const snapshot = useMemo(
    () => buildSnapshot(deps),
    [
      deps.player.queue,
      deps.player.currentIndex,
      deps.player.currentTrack,
      deps.player.isPlaying,
      deps.player.volume,
      deps.player.muted,
      deps.shuffle,
      deps.repeat,
      deps.activeSessionId,
      deps.focusModes.activeModeId,
      deps.sessions.sessions,
      deps.focusModes.modes,
      deps.focusTimer.state,
      deps.focusTimer.remainingSeconds,
      deps.focusTimer.settings,
      deps.appSettings.settings,
      deps.appSettings.importError,
    ]
  );

  const depsRef = useRef(deps);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    let disposed = false;
    const setup = async () => {
      try {
        const listeners = [
          listenTypedEvent(RUNTIME_EVENTS.requestSnapshot, () => {
            emitToOptions(RUNTIME_EVENTS.snapshot, snapshotRef.current).catch(() => {});
          }),
          listenTypedEvent(RUNTIME_EVENTS.command, (command) => {
            handleRuntimeCommand(command as RuntimeCommand, depsRef.current);
          }),
        ];
        for (const pending of listeners) {
          const unlisten = await pending;
          if (disposed) {
            try {
              unlisten();
            } catch {
              // no-op
            }
            continue;
          }
          unlistenFns.push(unlisten);
        }
      } catch {
        // browser mode
      }
    };
    setup();

    return () => {
      disposed = true;
      for (const fn of unlistenFns) {
        try {
          fn();
        } catch {
          // no-op
        }
      }
    };
  }, []);

  useEffect(() => {
    emitToOptions(RUNTIME_EVENTS.snapshot, snapshot).catch(() => {});
  }, [snapshot]);

  return { snapshot };
}
