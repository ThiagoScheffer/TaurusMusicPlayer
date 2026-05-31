import { useEffect } from "react";
import { GLOBAL_SHORTCUT_EVENTS } from "../../ipc/events";

interface ShortcutActions {
  togglePlayPause: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  toggleMuted: () => void;
}

export function useGlobalShortcutSubscriptions(getActions: () => ShortcutActions) {
  useEffect(() => {
    let unlistenFns: Array<() => void> = [];

    const setupHotkeyListeners = async () => {
      try {
        const tauriEvent = (window as Window & {
          __TAURI__?: {
            event?: {
              listen?: (event: string, cb: () => void) => Promise<() => void>;
            };
          };
        }).__TAURI__?.event;

        const listen = tauriEvent?.listen;
        if (!listen) return;

        const unlistenPlayPause = await listen(GLOBAL_SHORTCUT_EVENTS.playPause, () => {
          getActions().togglePlayPause();
        });
        const unlistenNext = await listen(GLOBAL_SHORTCUT_EVENTS.nextTrack, () => {
          getActions().nextTrack();
        });
        const unlistenPrevious = await listen(GLOBAL_SHORTCUT_EVENTS.previousTrack, () => {
          getActions().previousTrack();
        });
        const unlistenMute = await listen(GLOBAL_SHORTCUT_EVENTS.toggleMute, () => {
          getActions().toggleMuted();
        });

        unlistenFns = [unlistenPlayPause, unlistenNext, unlistenPrevious, unlistenMute];
      } catch {
        // Browser-only dev mode: Tauri API is unavailable.
      }
    };

    setupHotkeyListeners();

    return () => {
      for (const unlisten of unlistenFns) {
        try {
          unlisten();
        } catch {
          // no-op
        }
      }
    };
  }, [getActions]);
}

