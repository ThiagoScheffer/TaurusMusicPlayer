import { emitTo, listen } from "@tauri-apps/api/event";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { EXTERNAL_AUDIO_EVENTS, GLOBAL_SHORTCUT_EVENTS, RUNTIME_EVENTS, TRAY_EVENTS } from "./events";
import type { BlacklistEntry, FocusMode } from "../types/player";
import type { RuntimeSnapshot } from "../runtime/RuntimeSnapshot";

export interface AppEventPayloads {
  [GLOBAL_SHORTCUT_EVENTS.playPause]: void;
  [GLOBAL_SHORTCUT_EVENTS.stopTrack]: void;
  [GLOBAL_SHORTCUT_EVENTS.nextTrack]: void;
  [GLOBAL_SHORTCUT_EVENTS.previousTrack]: void;
  [GLOBAL_SHORTCUT_EVENTS.toggleMute]: void;
  [TRAY_EVENTS.playPause]: void;
  [TRAY_EVENTS.stopTrack]: void;
  [TRAY_EVENTS.nextTrack]: void;
  [TRAY_EVENTS.previousTrack]: void;
  [RUNTIME_EVENTS.requestSnapshot]: void;
  [RUNTIME_EVENTS.snapshot]: RuntimeSnapshot;
  [RUNTIME_EVENTS.command]: RuntimeCommand;
  [RUNTIME_EVENTS.settingsExport]: { json: string };
  [EXTERNAL_AUDIO_EVENTS.state]: ExternalAudioStatePayload;
}

export type AppEventName = keyof AppEventPayloads;

export interface ExternalAudioStatePayload {
  trackId: string;
  current: number | null;
  duration: number | null;
  isPlaying: boolean;
  isPaused: boolean;
  loading: boolean;
  seekable: boolean;
  ended: boolean;
  error?: string;
}

export type RuntimeCommand =
  | { type: "queue.play-index"; index: number }
  | { type: "queue.remove-track"; id: string }
  | { type: "queue.clear" }
  | { type: "queue.dedup" }
  | { type: "session.save-current-queue"; name: string }
  | { type: "session.start"; sessionId: string }
  | { type: "session.append-current-queue"; sessionId: string }
  | { type: "session.replace-with-current-queue"; sessionId: string }
  | { type: "session.remove-track"; sessionId: string; trackId: string }
  | { type: "session.rename"; sessionId: string; name: string }
  | { type: "session.duplicate"; sessionId: string }
  | { type: "session.delete"; sessionId: string }
  | { type: "focus-mode.select"; modeId: string }
  | { type: "focus-mode.create"; name: string }
  | {
      type: "focus-mode.edit";
      modeId: string;
      update: Partial<FocusMode>;
    }
  | { type: "focus-mode.delete"; modeId: string }
  | { type: "focus-timer.start" }
  | { type: "focus-timer.pause" }
  | { type: "focus-timer.resume" }
  | { type: "focus-timer.reset" }
  | { type: "focus-timer.skip" }
  | { type: "focus-timer.set-focus-minutes"; minutes: number }
  | { type: "focus-timer.set-short-break-minutes"; minutes: number }
  | { type: "focus-timer.set-long-break-minutes"; minutes: number }
  | { type: "focus-timer.set-break-behavior"; behavior: "continue" | "pause" | "lowerVolume" }
  | { type: "focus-timer.set-break-volume"; volume: number }
  | {
      type: "settings.update-playback";
      patch: Partial<{
        defaultVolume: number;
        autoplayNext: boolean;
        rememberLastTrack: boolean;
        skipBlacklistedTracks: boolean;
        blacklistedVideoIds: string[];
        blacklistEntries: BlacklistEntry[];
      }>;
    }
  | { type: "settings.import"; json: string }
  | { type: "settings.reset" }
  | { type: "settings.export-request" };

type PayloadArg<T> = [T] extends [void] ? [] : [payload: T];

export function emitToMain<K extends AppEventName>(
  event: K,
  ...payload: PayloadArg<AppEventPayloads[K]>
): Promise<void> {
  return emitTo("main", event, payload[0]);
}

export function emitToOptions<K extends AppEventName>(
  event: K,
  ...payload: PayloadArg<AppEventPayloads[K]>
): Promise<void> {
  return emitTo("options", event, payload[0]);
}

export function listenTypedEvent<K extends AppEventName>(
  event: K,
  handler: (payload: AppEventPayloads[K], eventData: Event<AppEventPayloads[K]>) => void
): Promise<UnlistenFn> {
  return listen<AppEventPayloads[K]>(event, (eventData) => {
    handler(eventData.payload, eventData);
  });
}
