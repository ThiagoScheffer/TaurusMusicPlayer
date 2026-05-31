import YouTube from "react-youtube";
import { useCallback, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRuntimeController } from "../../runtime/useRuntimeController";
import { formatTime } from "../../lib/time";
import { useFocusModes } from "../focus-modes/useFocusModes";
import { useFocusTimer } from "../focus-timer/useFocusTimer";
import { useSessions } from "../sessions/useSessions";
import { useAppSettings } from "../settings/useAppSettings";
import { usePlayer } from "./usePlayer";

export function PlayerView() {
  const appSettings = useAppSettings();
  const [shuffle] = useState(false);
  const [repeat] = useState<"off" | "one" | "all">("off");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const player = usePlayer({
    defaultVolume: appSettings.settings.playback.defaultVolume,
    autoplayNext: appSettings.settings.playback.autoplayNext,
    rememberLastTrack: appSettings.settings.playback.rememberLastTrack,
    skipBlacklistedTracks: appSettings.settings.playback.skipBlacklistedTracks,
    blacklistedVideoIds: appSettings.settings.playback.blacklistedVideoIds,
    blacklistEntries: appSettings.settings.playback.blacklistEntries,
  });

  const focusTimer = useFocusTimer({
    isPlaying: player.isPlaying,
    volume: player.volume,
    play: player.play,
    pause: player.pause,
    setVolume: player.setVolume,
  });

  const sessions = useSessions({
    queue: player.queue,
    volume: player.volume,
    muted: player.muted,
    startSessionInPlayer: () => {},
  });

  const applySession = useCallback(
    (sessionId: string) => {
      const session = sessions.getSessionById(sessionId);
      if (!session) return;
      player.startSession(session);
      setActiveSessionId(sessionId);
    },
    [sessions, player]
  );

  const focusModes = useFocusModes({
    sessions: sessions.sessions,
    setVolume: player.setVolume,
    startSessionById: applySession,
  });

  useRuntimeController({
    player,
    sessions,
    focusModes,
    focusTimer,
    appSettings,
    activeSessionId,
    applySession,
    shuffle,
    repeat,
  });

  const openOptionsWindow = async () => {
    try {
      const existing = await WebviewWindow.getByLabel("options");
      if (existing) {
        await existing.unminimize().catch(() => {});
        await existing.show();
        await existing.setFocus();
        return;
      }

      const options = new WebviewWindow("options", {
        url: "index.html?window=options",
        title: "Taurus Codewave Options",
        width: 760,
        height: 620,
        minWidth: 620,
        minHeight: 480,
        resizable: true,
        decorations: true,
        focus: true,
      });

      options.once("tauri://error", (e) => {
        console.error("Failed to create options window", e);
      });
      options.once("tauri://created", async () => {
        try {
          await options.setFocus();
        } catch {
          // no-op
        }
      });
    } catch (err) {
      console.error("Failed to open Tauri options window, falling back to browser window:", err);
      window.open(
        `${window.location.pathname}?window=options`,
        "taurus-options",
        "width=760,height=620,resizable=yes"
      );
    }
  };

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // browser mode no-op
    }
  };

  const handleHide = async () => {
    try {
      await getCurrentWindow().hide();
    } catch {
      // browser mode no-op
    }
  };

  const handleAddOrLoad = () => {
    if (!player.currentTrack) {
      player.playNowFromInput();
      return;
    }
    player.addToQueue();
  };

  return (
    <div className={`page mode-${focusModes.activeMode?.themeIntensity ?? "neutral"}`}>
      <div className="winamp">
        <div className="titlebar" data-tauri-drag-region>
          <div className="title">TAURUS CODEWAVE</div>
          <div className="titlebar-right">
            <div className="subtitle" title={`Music for Productivity ;) · ${focusModes.activeMode?.name ?? "No Mode"}`}>
              Music for Productivity ;) · {focusModes.activeMode?.name ?? "No Mode"}
            </div>
            <button className="menu-btn" onClick={openOptionsWindow} aria-label="Options">☰</button>
            <button className="menu-btn" onClick={handleMinimize} aria-label="Minimize">−</button>
            <button className="menu-btn" onClick={handleHide} aria-label="Hide to tray">×</button>
          </div>
        </div>

        <div className="screen">
          <div className="track">
            <span className="label">URL/ID</span>
            <input className="url" value={player.input} onChange={(e) => player.setInput(e.target.value)} />
            <button className="btn small" onClick={handleAddOrLoad}>ADD/LOAD</button>
          </div>

          <div className="row">
            <div className="time">
              <span>{formatTime(player.current)}</span>
              <span className="sep">/</span>
              <span>{formatTime(player.duration)}</span>
            </div>
            <div className="pill">
              <span className={`dot ${player.isPlaying ? "on" : ""}`} />
              <span>{player.isPlaying ? "PLAY" : "STOP"}</span>
            </div>
          </div>

          <div className="seek">
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(player.duration))}
              value={Math.min(player.current, player.duration || 0)}
              onMouseDown={() => player.setDragging(true)}
              onMouseUp={() => player.setDragging(false)}
              onTouchStart={() => player.setDragging(true)}
              onTouchEnd={() => player.setDragging(false)}
              onChange={(e) => player.setCurrent(Number(e.target.value))}
              onMouseUpCapture={(e) => player.seekTo(Number((e.target as HTMLInputElement).value))}
              onTouchEndCapture={(e) => player.seekTo(Number((e.target as HTMLInputElement).value))}
            />
          </div>

          <div className="current-track">
            Current: {player.currentTrack ? player.currentTrack.title || player.currentTrack.videoId : "No track selected"}
          </div>
          <div className="queue-sub">Queue: {player.queue.length} · Timer: {focusTimer.state} {formatTime(focusTimer.remainingSeconds)}</div>
        </div>

        <div className="controls">
          <button className="btn small" onClick={player.previousTrack} disabled={!player.videoId}>⏮</button>
          <button className="btn small" onClick={player.isPlaying ? player.pause : player.play} disabled={!player.videoId}>
            {player.isPlaying ? "⏸" : "▶"}
          </button>
          <button className="btn small" onClick={player.stop} disabled={!player.videoId}>■</button>
          <button className="btn small" onClick={player.nextTrack} disabled={!player.videoId}>⏭</button>
          <div className="vol">
            <button className="btn small" onClick={player.toggleMuted} disabled={!player.videoId}>
              {player.muted ? "UNMUTE" : "MUTE"}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={player.volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
              disabled={!player.videoId}
            />
          </div>
        </div>

        {player.videoId && (
          <div className="yt">
            <YouTube
              videoId={player.videoId}
              opts={player.opts}
              onReady={player.onReady}
              onStateChange={player.onStateChange}
              onError={player.onError}
            />
          </div>
        )}
      </div>
    </div>
  );
}
