export const RUNTIME_EVENTS = {
  requestSnapshot: "runtime://request-snapshot",
  snapshot: "runtime://snapshot",
  command: "runtime://command",
  settingsExport: "runtime://settings-export",
} as const;

export const RUNTIME_WINDOWS = {
  main: "main",
  options: "options",
} as const;
