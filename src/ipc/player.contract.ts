import { emitTo, listen } from "@tauri-apps/api/event";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { GLOBAL_SHORTCUT_EVENTS, PLAYER_EVENTS, RUNTIME_EVENTS } from "./events";
import type { Track } from "../types/player";
import type { FocusMode } from "../types/player";
import type { RuntimeSnapshot } from "../runtime/RuntimeSnapshot";

export interface PlayerStatePayload {
  queue: Track[];
  currentIndex: number;
}

export interface AppEventPayloads {
  [PLAYER_EVENTS.playIndex]: { index: number };
  [PLAYER_EVENTS.removeTrack]: { id: string };
  [PLAYER_EVENTS.clearQueue]: void;
  [PLAYER_EVENTS.dedupQueue]: void;
  [PLAYER_EVENTS.startSession]: { sessionId: string };
  [PLAYER_EVENTS.requestState]: void;
  [PLAYER_EVENTS.state]: PlayerStatePayload;
  [PLAYER_EVENTS.setFocusMode]: { modeId: string };
  [GLOBAL_SHORTCUT_EVENTS.playPause]: void;
  [GLOBAL_SHORTCUT_EVENTS.nextTrack]: void;
  [GLOBAL_SHORTCUT_EVENTS.previousTrack]: void;
  [GLOBAL_SHORTCUT_EVENTS.toggleMute]: void;
  [RUNTIME_EVENTS.requestSnapshot]: void;
  [RUNTIME_EVENTS.snapshot]: RuntimeSnapshot;
  [RUNTIME_EVENTS.command]: RuntimeCommand;
}

export type AppEventName = keyof AppEventPayloads;

export type RuntimeCommand =
  | { type: "queue.play-index"; index: number }
  | { type: "queue.remove-track"; id: string }
  | { type: "queue.clear" }
  | { type: "queue.dedup" }
  | { type: "session.save-current-queue"; name: string }
  | { type: "session.start"; sessionId: string }
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
  | { type: "focus-timer.set-break-volume"; volume: number };

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
