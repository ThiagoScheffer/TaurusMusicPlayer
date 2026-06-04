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
  settingsExport: "runtime://settings-export",
} as const;

export const EXTERNAL_AUDIO_EVENTS = {
  state: "external-audio://state",
} as const;

export const APP_EVENTS = {
  ...GLOBAL_SHORTCUT_EVENTS,
  ...RUNTIME_EVENTS,
  ...EXTERNAL_AUDIO_EVENTS,
} as const;
