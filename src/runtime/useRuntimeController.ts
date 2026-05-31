import { useEffect, useMemo } from "react";
import { PLAYER_EVENTS, RUNTIME_EVENTS } from "../ipc/events";
import { emitToOptions, listenTypedEvent, type RuntimeCommand } from "../ipc/player.contract";
import type { RuntimeSnapshot } from "./RuntimeSnapshot";
import type { usePlayer } from "../features/player/usePlayer";
import type { useSessions } from "../features/sessions/useSessions";
import type { useFocusModes } from "../features/focus-modes/useFocusModes";
import type { useFocusTimer } from "../features/focus-timer/useFocusTimer";
import type { AppSettings } from "../features/settings/useAppSettings";

export type RuntimeControllerDeps = {
  player: ReturnType<typeof usePlayer>;
  sessions: ReturnType<typeof useSessions>;
  focusModes: ReturnType<typeof useFocusModes>;
  focusTimer: ReturnType<typeof useFocusTimer>;
  settings: AppSettings;
  activeSessionId: string | null;
  applySession: (sessionId: string) => void;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
};

function buildSnapshot(deps: RuntimeControllerDeps): RuntimeSnapshot {
  const { player, sessions, focusModes, focusTimer, settings, activeSessionId, shuffle, repeat } = deps;
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
    settings,
  };
}

function handleRuntimeCommand(command: RuntimeCommand, deps: RuntimeControllerDeps) {
  const { player, sessions, focusModes, focusTimer, applySession } = deps;
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
    default:
      break;
  }
}

function handleLegacyPlayerEvents(deps: RuntimeControllerDeps) {
  const { player, applySession } = deps;
  return [
    listenTypedEvent(PLAYER_EVENTS.playIndex, (payload) => {
      if (typeof payload.index === "number") player.playTrackImmediately(payload.index);
    }),
    listenTypedEvent(PLAYER_EVENTS.removeTrack, (payload) => {
      if (payload.id) player.removeFromQueue(payload.id);
    }),
    listenTypedEvent(PLAYER_EVENTS.clearQueue, () => player.clearQueue()),
    listenTypedEvent(PLAYER_EVENTS.dedupQueue, () => player.removeDuplicates()),
    listenTypedEvent(PLAYER_EVENTS.startSession, (payload) => applySession(payload.sessionId)),
    listenTypedEvent(PLAYER_EVENTS.requestState, () => {
      emitToOptions(PLAYER_EVENTS.state, {
        queue: player.queue,
        currentIndex: player.currentIndex,
      }).catch(() => {});
    }),
  ];
}

function subscribeRuntimeEvents(deps: RuntimeControllerDeps, getSnapshot: () => RuntimeSnapshot) {
  return [
    listenTypedEvent(RUNTIME_EVENTS.requestSnapshot, () => {
      emitToOptions(RUNTIME_EVENTS.snapshot, getSnapshot()).catch(() => {});
    }),
    listenTypedEvent(RUNTIME_EVENTS.command, (command) => {
      handleRuntimeCommand(command as RuntimeCommand, deps);
    }),
  ];
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
      deps.settings,
    ]
  );

  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    const setup = async () => {
      try {
        const listeners = [
          ...handleLegacyPlayerEvents(deps),
          ...subscribeRuntimeEvents(deps, () => snapshot),
        ];
        for (const pending of listeners) {
          unlistenFns.push(await pending);
        }
      } catch {
        // browser mode
      }
    };
    setup();

    return () => {
      for (const fn of unlistenFns) {
        try {
          fn();
        } catch {
          // no-op
        }
      }
    };
  }, [deps, snapshot]);

  useEffect(() => {
    emitToOptions(PLAYER_EVENTS.state, {
      queue: deps.player.queue,
      currentIndex: deps.player.currentIndex,
    }).catch(() => {});
    emitToOptions(RUNTIME_EVENTS.snapshot, snapshot).catch(() => {});
  }, [deps.player.queue, deps.player.currentIndex, snapshot]);

  return { snapshot };
}

