export const PLAYER_EVENTS = {
  playIndex: "player://play-index",
  removeTrack: "player://remove-track",
  clearQueue: "player://clear-queue",
  dedupQueue: "player://dedup-queue",
  startSession: "player://start-session",
  requestState: "player://request-state",
  state: "player://state",
  setFocusMode: "player://set-focus-mode",
} as const;

export const GLOBAL_SHORTCUT_EVENTS = {
  playPause: "global-shortcut://play-pause",
  nextTrack: "global-shortcut://next-track",
  previousTrack: "global-shortcut://previous-track",
  toggleMute: "global-shortcut://toggle-mute",
} as const;

export const RUNTIME_EVENTS = {
  requestSnapshot: "runtime://request-snapshot",
  snapshot: "runtime://snapshot",
  command: "runtime://command",
} as const;

export const APP_EVENTS = {
  ...PLAYER_EVENTS,
  ...GLOBAL_SHORTCUT_EVENTS,
  ...RUNTIME_EVENTS,
} as const;
