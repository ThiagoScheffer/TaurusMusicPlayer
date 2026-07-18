import { isTauri } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { backupFilename } from "./backup";

const BACKUP_FILTER = [{ name: "Taurus Music Player Backup", extensions: ["json"] }];

export type BackupFileResult =
  | { status: "completed"; json?: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };

export async function saveBackupFile(json: string): Promise<BackupFileResult> {
  try {
    if (isTauri()) {
      const path = await save({
        title: "Export Taurus Music Player Backup",
        defaultPath: backupFilename(),
        filters: BACKUP_FILTER,
      });
      if (!path) return { status: "cancelled" };
      await writeTextFile(path, json);
      return { status: "completed" };
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupFilename();
    anchor.click();
    URL.revokeObjectURL(url);
    return { status: "completed" };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export async function openBackupFile(): Promise<BackupFileResult> {
  try {
    if (isTauri()) {
      const path = await open({
        title: "Import Taurus Music Player Backup",
        multiple: false,
        filters: BACKUP_FILTER,
      });
      if (!path || Array.isArray(path)) return { status: "cancelled" };
      return { status: "completed", json: await readTextFile(path) };
    }

    const json = await new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await file.text() : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
    return json === null ? { status: "cancelled" } : { status: "completed", json };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export async function confirmBackupReplace(): Promise<boolean> {
  const message = "Importing a backup replaces all current Taurus settings, queues, sessions, and focus data. Continue?";
  if (!isTauri()) return window.confirm(message);
  return ask(message, {
    title: "Replace Taurus Music Player Data",
    kind: "warning",
    okLabel: "Replace",
    cancelLabel: "Cancel",
  });
}
