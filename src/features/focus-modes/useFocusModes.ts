import { useEffect, useState } from "react";
import type { FocusMode, Session } from "../../types/player";

const MODES_KEY = "taurus.focusModes";
const ACTIVE_MODE_KEY = "taurus.focusModes.activeId";

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultModes(): FocusMode[] {
  return [
    {
      id: nowId(),
      name: "Deep Work",
      description: "Minimal interruptions and steady volume.",
      defaultVolume: 55,
      shuffle: false,
      tags: ["focus", "deep-work"],
      themeIntensity: "calm",
    },
    {
      id: nowId(),
      name: "Coding",
      description: "Energy for coding sessions.",
      defaultVolume: 70,
      shuffle: true,
      tags: ["coding", "flow"],
      themeIntensity: "neutral",
    },
    {
      id: nowId(),
      name: "Reading",
      description: "Lower energy and distraction-free.",
      defaultVolume: 45,
      shuffle: false,
      tags: ["reading", "calm"],
      themeIntensity: "calm",
    },
    {
      id: nowId(),
      name: "Study",
      description: "Balanced study pace.",
      defaultVolume: 60,
      shuffle: true,
      tags: ["study", "focus"],
      themeIntensity: "neutral",
    },
    {
      id: nowId(),
      name: "Night Coding",
      description: "Late-night focused coding.",
      defaultVolume: 50,
      shuffle: false,
      tags: ["night", "coding"],
      themeIntensity: "intense",
    },
  ];
}

function readModes(): FocusMode[] {
  const raw = localStorage.getItem(MODES_KEY);
  const defaults = makeDefaultModes();
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;

    const valid = parsed.filter((item): item is FocusMode => {
      if (!item || typeof item !== "object") return false;
      const m = item as Partial<FocusMode>;
      return (
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        typeof m.defaultVolume === "number" &&
        typeof m.shuffle === "boolean" &&
        Array.isArray(m.tags) &&
        (m.themeIntensity === "calm" || m.themeIntensity === "neutral" || m.themeIntensity === "intense")
      );
    });

    const names = new Set(valid.map((m) => m.name));
    const missingDefaults = defaults.filter((d) => !names.has(d.name));
    return [...valid, ...missingDefaults];
  } catch {
    return defaults;
  }
}

function readActiveModeId(modes: FocusMode[]): string {
  const raw = localStorage.getItem(ACTIVE_MODE_KEY);
  if (raw && modes.some((m) => m.id === raw)) return raw;
  return modes[0]?.id ?? "";
}

interface UseFocusModesArgs {
  sessions: Session[];
  setVolume: (v: number) => void;
  startSessionById: (sessionId: string) => void;
}

export function useFocusModes({ sessions, setVolume, startSessionById }: UseFocusModesArgs) {
  const [modes, setModes] = useState<FocusMode[]>(readModes);
  const [activeModeId, setActiveModeId] = useState<string>(() => readActiveModeId(readModes()));

  useEffect(() => {
    localStorage.setItem(MODES_KEY, JSON.stringify(modes));
  }, [modes]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_MODE_KEY, activeModeId);
  }, [activeModeId]);

  useEffect(() => {
    if (!modes.some((m) => m.id === activeModeId)) {
      setActiveModeId(modes[0]?.id ?? "");
    }
  }, [modes, activeModeId]);

  const activeMode = modes.find((m) => m.id === activeModeId) ?? null;

  const selectMode = (modeId: string) => {
    const mode = modes.find((m) => m.id === modeId);
    if (!mode) return;

    setActiveModeId(modeId);
    setVolume(Math.min(100, Math.max(0, mode.defaultVolume)));

    if (mode.preferredSessionId) {
      const exists = sessions.some((s) => s.id === mode.preferredSessionId);
      if (exists) {
        startSessionById(mode.preferredSessionId);
      }
    }
  };

  const createMode = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const mode: FocusMode = {
      id: nowId(),
      name: trimmed,
      defaultVolume: 60,
      shuffle: false,
      tags: [],
      themeIntensity: "neutral",
    };
    setModes((prev) => [mode, ...prev]);
  };

  const editMode = (modeId: string, update: Partial<FocusMode>) => {
    setModes((prev) =>
      prev.map((mode) =>
        mode.id === modeId
          ? {
              ...mode,
              ...update,
              defaultVolume:
                typeof update.defaultVolume === "number"
                  ? Math.min(100, Math.max(0, update.defaultVolume))
                  : mode.defaultVolume,
            }
          : mode
      )
    );
  };

  const deleteMode = (modeId: string) => {
    setModes((prev) => prev.filter((m) => m.id !== modeId));
  };

  return {
    modes,
    activeModeId,
    activeMode,
    selectMode,
    createMode,
    editMode,
    deleteMode,
  };
}
