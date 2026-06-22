import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { GLOBAL_SHORTCUT_EVENTS, TRAY_EVENTS } from "../../ipc/events";

interface ShortcutActions {
  togglePlayPause: () => void;
  stop: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  toggleMuted: () => void;
}

export function useGlobalShortcutSubscriptions(getActions: () => ShortcutActions) {
  const getActionsRef = useRef(getActions);

  useEffect(() => {
    getActionsRef.current = getActions;
  }, [getActions]);

  useEffect(() => {
    let unlistenFns: Array<() => void> = [];
    let disposed = false;

    const setupHotkeyListeners = async () => {
      try {
        const unlistenPlayPause = await listen(GLOBAL_SHORTCUT_EVENTS.playPause, () => {
          getActionsRef.current().togglePlayPause();
        });
        const unlistenTrayPlayPause = await listen(TRAY_EVENTS.playPause, () => {
          getActionsRef.current().togglePlayPause();
        });
        const unlistenStop = await listen(GLOBAL_SHORTCUT_EVENTS.stopTrack, () => {
          getActionsRef.current().stop();
        });
        const unlistenTrayStop = await listen(TRAY_EVENTS.stopTrack, () => {
          getActionsRef.current().stop();
        });
        const unlistenNext = await listen(GLOBAL_SHORTCUT_EVENTS.nextTrack, () => {
          getActionsRef.current().nextTrack();
        });
        const unlistenTrayNext = await listen(TRAY_EVENTS.nextTrack, () => {
          getActionsRef.current().nextTrack();
        });
        const unlistenPrevious = await listen(GLOBAL_SHORTCUT_EVENTS.previousTrack, () => {
          getActionsRef.current().previousTrack();
        });
        const unlistenTrayPrevious = await listen(TRAY_EVENTS.previousTrack, () => {
          getActionsRef.current().previousTrack();
        });
        const unlistenMute = await listen(GLOBAL_SHORTCUT_EVENTS.toggleMute, () => {
          getActionsRef.current().toggleMuted();
        });

        unlistenFns = [
          unlistenPlayPause,
          unlistenTrayPlayPause,
          unlistenStop,
          unlistenTrayStop,
          unlistenNext,
          unlistenTrayNext,
          unlistenPrevious,
          unlistenTrayPrevious,
          unlistenMute,
        ];
        if (disposed) {
          for (const unlisten of unlistenFns) {
            unlisten();
          }
          unlistenFns = [];
        }
      } catch {
        // Browser-only dev mode: Tauri API is unavailable.
      }
    };

    setupHotkeyListeners();

    return () => {
      disposed = true;
      for (const unlisten of unlistenFns) {
        try {
          unlisten();
        } catch {
          // no-op
        }
      }
    };
  }, []);
}
