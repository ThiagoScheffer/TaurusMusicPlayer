import YouTube from "react-youtube";
import { useEffect } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatTime } from "../../lib/time";
import { useFocusModes } from "../focus-modes/useFocusModes";
import { useFocusTimer } from "../focus-timer/useFocusTimer";
import { useSessions } from "../sessions/useSessions";
import { useAppSettings } from "../settings/useAppSettings";
import { usePlayer } from "./usePlayer";

export function PlayerView() {
  const appSettings = useAppSettings();

  const {
    input,
    setInput,
    queue,
    currentIndex,
    currentTrack,
    videoId,
    isPlaying,
    volume,
    setVolume,
    muted,
    toggleMuted,
    duration,
    current,
    setCurrent,
    setDragging,
    addToQueue,
    playNowFromInput,
    nextTrack,
    previousTrack,
    removeFromQueue,
    clearQueue,
    removeDuplicates,
    startSession,
    play,
    pause,
    stop,
    seekTo,
    opts,
    onReady,
    onStateChange,
    onError,
    playTrackImmediately,
  } = usePlayer({
    defaultVolume: appSettings.settings.playback.defaultVolume,
    autoplayNext: appSettings.settings.playback.autoplayNext,
    rememberLastTrack: appSettings.settings.playback.rememberLastTrack,
    skipBlacklistedTracks: appSettings.settings.playback.skipBlacklistedTracks,
    blacklistedVideoIds: appSettings.settings.playback.blacklistedVideoIds,
  });

  const focusTimer = useFocusTimer({ isPlaying, volume, play, pause, setVolume });

  const { sessions, getSessionById } = useSessions({
    queue,
    volume,
    muted,
    startSessionInPlayer: startSession,
  });

  const { activeMode } = useFocusModes({
    sessions,
    setVolume,
    startSessionById: (sessionId: string) => {
      const session = getSessionById(sessionId);
      if (!session) return;
      startSession(session);
    },
  });

  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    const setup = async () => {
      try {
        unlistenFns.push(
          await listen<{ index: number }>("player://play-index", (event) => {
            if (typeof event.payload.index === "number") {
              playTrackImmediately(event.payload.index);
            }
          })
        );
        unlistenFns.push(
          await listen<{ id: string }>("player://remove-track", (event) => {
            if (event.payload.id) removeFromQueue(event.payload.id);
          })
        );
        unlistenFns.push(await listen("player://clear-queue", () => clearQueue()));
        unlistenFns.push(await listen("player://dedup-queue", () => removeDuplicates()));
        unlistenFns.push(
          await listen<{ sessionId: string }>("player://start-session", (event) => {
            const session = getSessionById(event.payload.sessionId);
            if (session) startSession(session);
          })
        );
        unlistenFns.push(await listen("player://request-state", () => {
          emitTo("options", "player://state", { queue, currentIndex }).catch(() => {});
        }));
      } catch {
        // browser mode
      }
    };
    setup();

    return () => {
      for (const fn of unlistenFns) {
        try { fn(); } catch { /* no-op */ }
      }
    };
  }, [queue, currentIndex, getSessionById, startSession, playTrackImmediately, removeFromQueue, clearQueue, removeDuplicates]);

  useEffect(() => {
    emitTo("options", "player://state", { queue, currentIndex }).catch(() => {});
  }, [queue, currentIndex]);

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
    if (!currentTrack) {
      playNowFromInput();
      return;
    }
    addToQueue();
  };

  return (
    <div className={`page mode-${activeMode?.themeIntensity ?? "neutral"}`}>
      <div className="winamp">
        <div className="titlebar" data-tauri-drag-region>
          <div className="title">TAURUS CODEWAVE</div>
          <div className="titlebar-right">
            <div className="subtitle" title={`Music for Productivity ;) · ${activeMode?.name ?? "No Mode"}`}>
              Music for Productivity ;) · {activeMode?.name ?? "No Mode"}
            </div>
            <button className="menu-btn" onClick={openOptionsWindow} aria-label="Options">☰</button>
            <button className="menu-btn" onClick={handleMinimize} aria-label="Minimize">−</button>
            <button className="menu-btn" onClick={handleHide} aria-label="Hide to tray">×</button>
          </div>
        </div>

        <div className="screen">
          <div className="track">
            <span className="label">URL/ID</span>
            <input className="url" value={input} onChange={(e) => setInput(e.target.value)} />
            <button className="btn small" onClick={handleAddOrLoad}>ADD/LOAD</button>
          </div>

          <div className="row">
            <div className="time">
              <span>{formatTime(current)}</span>
              <span className="sep">/</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="pill">
              <span className={`dot ${isPlaying ? "on" : ""}`} />
              <span>{isPlaying ? "PLAY" : "STOP"}</span>
            </div>
          </div>

          <div className="seek">
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              value={Math.min(current, duration || 0)}
              onMouseDown={() => setDragging(true)}
              onMouseUp={() => setDragging(false)}
              onTouchStart={() => setDragging(true)}
              onTouchEnd={() => setDragging(false)}
              onChange={(e) => setCurrent(Number(e.target.value))}
              onMouseUpCapture={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
              onTouchEndCapture={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
            />
          </div>

          <div className="current-track">
            Current: {currentTrack ? currentTrack.title || currentTrack.videoId : "No track selected"}
          </div>
          <div className="queue-sub">Queue: {queue.length} · Timer: {focusTimer.state} {formatTime(focusTimer.remainingSeconds)}</div>
        </div>

        <div className="controls">
          <button className="btn small" onClick={previousTrack} disabled={!videoId}>⏮</button>
          <button className="btn small" onClick={isPlaying ? pause : play} disabled={!videoId}>{isPlaying ? "⏸" : "▶"}</button>
          <button className="btn small" onClick={stop} disabled={!videoId}>■</button>
          <button className="btn small" onClick={nextTrack} disabled={!videoId}>⏭</button>
          <div className="vol">
            <button className="btn small" onClick={toggleMuted} disabled={!videoId}>{muted ? "UNMUTE" : "MUTE"}</button>
            <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} disabled={!videoId} />
          </div>
        </div>

        {videoId && (
          <div className="yt">
            <YouTube videoId={videoId} opts={opts} onReady={onReady} onStateChange={onStateChange} onError={onError} />
          </div>
        )}
      </div>
    </div>
  );
}
