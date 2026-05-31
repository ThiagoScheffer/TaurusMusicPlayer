import type { AppSettings } from "../features/settings/useAppSettings";

export interface SettingsSnapshot {
  settings: AppSettings;
  importError: string | null;
}

