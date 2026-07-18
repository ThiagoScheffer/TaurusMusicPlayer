export const GLOBAL_SHORTCUT_EVENTS = {
  playPause: "global-shortcut://play-pause",
  stopTrack: "global-shortcut://stop-track",
  nextTrack: "global-shortcut://next-track",
  previousTrack: "global-shortcut://previous-track",
  toggleMute: "global-shortcut://toggle-mute",
} as const;

export const TRAY_EVENTS = {
  playPause: "tray://play-pause",
  stopTrack: "tray://stop-track",
  nextTrack: "tray://next-track",
  previousTrack: "tray://previous-track",
} as const;

export const RUNTIME_EVENTS = {
  requestSnapshot: "runtime://request-snapshot",
  snapshot: "runtime://snapshot",
  command: "runtime://command",
  settingsExport: "runtime://settings-export",
  settingsImportResult: "runtime://settings-import-result",
} as const;

export const EXTERNAL_AUDIO_EVENTS = {
  state: "external-audio://state",
} as const;

export const APP_EVENTS = {
  ...GLOBAL_SHORTCUT_EVENTS,
  ...TRAY_EVENTS,
  ...RUNTIME_EVENTS,
  ...EXTERNAL_AUDIO_EVENTS,
} as const;
