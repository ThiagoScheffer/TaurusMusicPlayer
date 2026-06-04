import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { extractYoutubeInfo } from "../../lib/youtube";
import { EXTERNAL_AUDIO_EVENTS } from "../../ipc/events";
import { listenTypedEvent } from "../../ipc/player.contract";
import type { ExternalAudioStatePayload } from "../../ipc/player.contract";
import type { BlacklistEntry, Session, Track } from "../../types/player";
import { isTrackBlacklisted } from "./useBlacklist";
import { useGlobalShortcutSubscriptions } from "./usePlayerEvents";
import { DEFAULT_URL, readPersistedPlayerInit, usePlayerPersistence } from "./usePlayerPersistence";
import { makeTrack, useQueueTitleEnrichment, useYouTubePlayerOpts, type YouTubePlayer } from "./useYouTubePlayer";

interface UsePlayerConfig {
  defaultVolume: number;
  autoplayNext: boolean;
  rememberLastTrack: boolean;
  skipBlacklistedTracks: boolean;
  blacklistedVideoIds: string[];
  blacklistEntries: BlacklistEntry[];
}

function clampStartIndex(queueLength: number, startIndex?: number): number {
  if (queueLength <= 0) return -1;
  if (typeof startIndex !== "number" || Number.isNaN(startIndex)) return 0;
  return Math.min(queueLength - 1, Math.max(0, Math.floor(startIndex)));
}

function cloneTracks(tracks: Track[]): Track[] {
  return tracks.map((track) => ({ ...track }));
}

export function buildQueueFromSession(session: Session): Track[] {
  return cloneTracks(session.queue);
}

export function usePlayer(config: UsePlayerConfig) {
  const usesExternalAudio = isTauri();
  const initial = readPersistedPlayerInit({
    defaultVolume: config.defaultVolume,
    rememberLastTrack: config.rememberLastTrack,
  });

  const [input, setInput] = useState(initial.storedInput ?? DEFAULT_URL);
  const [queue, setQueue] = useState<Track[]>(initial.initialQueue);
  const [currentIndex, setCurrentIndex] = useState(initial.initialIndex);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(initial.initialVolume);
  const [muted, setMuted] = useState(initial.initialMuted);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const pollRef = useRef<number | null>(null);
  const shouldAutoPlayRef = useRef(false);
  const trackSwitchPendingRef = useRef(false);
  const forcePlayIntervalRef = useRef<number | null>(null);
  const externalAudioStartedRef = useRef(false);
  const externalClockRef = useRef<number | null>(null);
  const activeTrackIdRef = useRef<string | null>(null);
  const actionsRef = useRef({
    togglePlayPause: () => {},
    nextTrack: () => {},
    previousTrack: () => {},
    toggleMuted: () => {},
  });

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const videoId = currentTrack?.videoId ?? null;
  const opts = useYouTubePlayerOpts();
  const trackPlaybackUrl = (track: Track) => track.sourceUrl || `https://www.youtube.com/watch?v=${track.videoId}`;

  const invokeExternalAudio = async (command: string, args?: Record<string, unknown>) => {
    if (!usesExternalAudio) return false;
    await invoke(command, args);
    return true;
  };

  const startExternalTrack = (track: Track) => {
    if (!usesExternalAudio) return false;
    activeTrackIdRef.current = track.id;
    invokeExternalAudio("play_external_audio", { url: trackPlaybackUrl(track), trackId: track.id })
      .then(() => {
        externalAudioStartedRef.current = true;
        setCurrent(0);
        setIsPlaying(true);
      })
      .catch((error) => {
        externalAudioStartedRef.current = false;
        setIsPlaying(false);
        window.alert(String(error));
      });
    return true;
  };

  const clearPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
    }
    pollRef.current = null;
  };

  const clearForcePlayInterval = () => {
    if (forcePlayIntervalRef.current) {
      window.clearInterval(forcePlayIntervalRef.current);
      forcePlayIntervalRef.current = null;
    }
  };

  const clearExternalClock = () => {
    if (externalClockRef.current) {
      window.clearInterval(externalClockRef.current);
      externalClockRef.current = null;
    }
  };

  const isBlacklisted = (track: Track | null) =>
    isTrackBlacklisted(track, {
      skipBlacklistedTracks: config.skipBlacklistedTracks,
      blacklistedVideoIds: config.blacklistedVideoIds,
      blacklistEntries: config.blacklistEntries,
    });

  const playTrackAtIndex = (index: number) => {
    if (index < 0 || index >= queue.length) return;
    let targetIndex = index;
    let track = queue[targetIndex];
    while (isBlacklisted(track) && targetIndex < queue.length - 1) {
      targetIndex += 1;
      track = queue[targetIndex];
    }
    if (isBlacklisted(track)) {
      setIsPlaying(false);
      setCurrent(0);
      return;
    }

    setCurrentIndex(targetIndex);
    setCurrent(0);
    setDuration(track.duration ?? 0);
    shouldAutoPlayRef.current = true;
    trackSwitchPendingRef.current = true;
    clearForcePlayInterval();

    const p = playerRef.current;
    if (startExternalTrack(track)) {
      setIsPlaying(true);
      return;
    }

    if (p?.loadVideoById) {
      try {
        p.stopVideo?.();
      } catch {
        // no-op
      }
      p.loadVideoById({ videoId: track.videoId, startSeconds: 0 });
      p.playVideo?.();
      const startedAt = Date.now();
      forcePlayIntervalRef.current = window.setInterval(() => {
        if (!trackSwitchPendingRef.current || Date.now() - startedAt > 2400) {
          clearForcePlayInterval();
          return;
        }
        try {
          playerRef.current?.playVideo?.();
        } catch {
          // no-op
        }
      }, 160);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (usesExternalAudio) return;
    if (!trackSwitchPendingRef.current || !currentTrack?.videoId) return;

    const retryLoadAndPlay = () => {
      try {
        const p = playerRef.current;
        if (!p) return;
        p.loadVideoById?.({ videoId: currentTrack.videoId, startSeconds: 0 });
        p.playVideo?.();
      } catch {
        // no-op
      }
    };

    const t1 = window.setTimeout(retryLoadAndPlay, 80);
    const t2 = window.setTimeout(retryLoadAndPlay, 260);
    const t3 = window.setTimeout(retryLoadAndPlay, 620);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [currentTrack?.id, currentTrack?.videoId, usesExternalAudio]);

  const addToQueue = () => {
    const trimmed = input.trim();
    const info = extractYoutubeInfo(trimmed);
    if (!info.videoId) {
      window.alert("Couldn't read that YouTube link / ID.");
      return;
    }

    const track = makeTrack(trimmed, info.videoId);
    setQueue((prev) => [...prev, track]);

    if (currentIndex === -1) {
      setCurrentIndex(0);
    }
  };

  const playNowFromInput = () => {
    const trimmed = input.trim();
    const info = extractYoutubeInfo(trimmed);
    if (!info.videoId) {
      window.alert("Couldn't read that YouTube link / ID.");
      return;
    }

    const track = makeTrack(trimmed, info.videoId);
    setQueue((prev) => {
      const next = [...prev, track];
      const nextIndex = next.length - 1;
      setTimeout(() => {
        setCurrentIndex(nextIndex);
      }, 0);
      return next;
    });

    const p = playerRef.current;
    if (startExternalTrack(track)) {
      setIsPlaying(true);
      setCurrent(0);
      return;
    }

    if (p?.loadVideoById) {
      shouldAutoPlayRef.current = true;
      p.loadVideoById({ videoId: info.videoId, startSeconds: info.startSeconds });
      setIsPlaying(true);
      setCurrent(0);
    }
  };

  const play = () => {
    if (usesExternalAudio) {
      if (!currentTrack) return;
      if (externalAudioStartedRef.current) {
        invokeExternalAudio("resume_external_audio").catch(() => startExternalTrack(currentTrack));
      } else {
        startExternalTrack(currentTrack);
      }
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
      return;
    }

    const p = playerRef.current;
    if (!p?.playVideo || !currentTrack) return;
    p.playVideo();
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  };

  const pause = () => {
    if (usesExternalAudio) {
      invokeExternalAudio("pause_external_audio").catch(() => {});
      shouldAutoPlayRef.current = false;
      setIsPlaying(false);
      return;
    }

    const p = playerRef.current;
    if (!p?.pauseVideo) return;
    p.pauseVideo();
    shouldAutoPlayRef.current = false;
    setIsPlaying(false);
  };

  const stop = () => {
    if (usesExternalAudio) {
      invokeExternalAudio("stop_external_audio").catch(() => {});
      externalAudioStartedRef.current = false;
      shouldAutoPlayRef.current = false;
      setIsPlaying(false);
      setCurrent(0);
      return;
    }

    const p = playerRef.current;
    try {
      p?.stopVideo?.();
    } catch {
      // no-op
    }
    shouldAutoPlayRef.current = false;
    setIsPlaying(false);
    setCurrent(0);
  };

  const nextTrack = () => {
    if (currentIndex < queue.length - 1) {
      playTrackAtIndex(currentIndex + 1);
      return;
    }

    setIsPlaying(false);
    setCurrent(0);
  };

  const previousTrack = () => {
    if (currentIndex > 0) {
      playTrackAtIndex(currentIndex - 1);
      return;
    }

    const p = playerRef.current;
    if (!usesExternalAudio) {
      p?.seekTo?.(0, true);
    }
    setCurrent(0);
  };

  const removeFromQueue = (id: string) => {
    setQueue((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;

      const next = prev.filter((t) => t.id !== id);

      if (next.length === 0) {
        setCurrentIndex(-1);
        stop();
      } else if (idx < currentIndex) {
        setCurrentIndex(currentIndex - 1);
      } else if (idx === currentIndex) {
        const newIndex = Math.min(currentIndex, next.length - 1);
        setCurrentIndex(newIndex);
        setTimeout(() => {
          const p = playerRef.current;
          const track = next[newIndex];
          if (track && startExternalTrack(track)) {
            setIsPlaying(true);
            return;
          }
          if (p?.loadVideoById && track) {
            p.loadVideoById({ videoId: track.videoId, startSeconds: 0 });
            setIsPlaying(true);
          }
        }, 0);
      }

      return next;
    });
  };

  const clearQueue = () => {
    setQueue([]);
    setCurrentIndex(-1);
    stop();
  };

  const removeDuplicates = () => {
    setQueue((prev) => {
      const seen = new Set<string>();
      const next: Track[] = [];
      let nextCurrentIndex = -1;
      const currentId = currentTrack?.id ?? null;

      for (const track of prev) {
        if (seen.has(track.videoId)) continue;
        seen.add(track.videoId);
        next.push(track);
        if (track.id === currentId) {
          nextCurrentIndex = next.length - 1;
        }
      }

      if (next.length === 0) {
        setCurrentIndex(-1);
        stop();
      } else if (nextCurrentIndex >= 0) {
        setCurrentIndex(nextCurrentIndex);
      } else {
        setCurrentIndex(Math.min(currentIndex, next.length - 1));
      }

      return next;
    });
  };

  const playTrackImmediately = (index: number) => {
    playTrackAtIndex(index);
  };

  const replaceQueue = (tracks: Track[], startIndex?: number) => {
    const nextQueue = cloneTracks(tracks);
    const nextIndex = clampStartIndex(nextQueue.length, startIndex);
    setQueue(nextQueue);
    setCurrentIndex(nextIndex);
    setCurrent(0);
    setDuration(nextIndex >= 0 ? (nextQueue[nextIndex]?.duration ?? 0) : 0);
    setIsPlaying(false);
    shouldAutoPlayRef.current = false;

    const p = playerRef.current;
    if (nextIndex >= 0 && p?.cueVideoById) {
      if (!usesExternalAudio) {
        p.cueVideoById({ videoId: nextQueue[nextIndex].videoId, startSeconds: 0 });
      }
    } else {
      try {
        p?.stopVideo?.();
      } catch {
        // no-op
      }
    }
  };

  const startSession = (session: Session) => {
    const sessionQueue = buildQueueFromSession(session);
    replaceQueue(sessionQueue, 0);
    setVolume(session.volume);
    setMuted(session.muted);
  };

  const applyVolume = (v: number, m: boolean) => {
    const p = playerRef.current;
    if (!p) return;

    const iframe = p.getIframe?.();
    if (!iframe || !iframe.src) return;

    try {
      p.setVolume?.(v);
      if (m) p.mute?.();
      else p.unMute?.();
    } catch {
      // player may be destroyed/unmounted
    }
  };

  const seekTo = (sec: number) => {
    if (usesExternalAudio) {
      const next = Math.max(0, sec);
      invokeExternalAudio("seek_external_audio", { seconds: next }).catch(() => {});
      return;
    }

    const p = playerRef.current;
    if (!p?.seekTo) return;
    p.seekTo(sec, true);
    setCurrent(sec);
  };

  const toggleMuted = () => {
    setMuted((m) => !m);
  };

  const togglePlayPause = () => {
    if (isPlaying) pause();
    else play();
  };

  actionsRef.current.togglePlayPause = togglePlayPause;
  actionsRef.current.nextTrack = nextTrack;
  actionsRef.current.previousTrack = previousTrack;
  actionsRef.current.toggleMuted = toggleMuted;

  usePlayerPersistence({
    volume,
    muted,
    input,
    queue,
    currentIndex,
    rememberLastTrack: config.rememberLastTrack,
  });

  useQueueTitleEnrichment({ queue, setQueue });

  useGlobalShortcutSubscriptions(() => actionsRef.current);

  useEffect(() => {
    activeTrackIdRef.current = currentTrack?.id ?? null;
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!usesExternalAudio) return;

    let disposed = false;
    const unlistenPromise = listenTypedEvent(EXTERNAL_AUDIO_EVENTS.state, (payload: ExternalAudioStatePayload) => {
      if (disposed || payload.trackId !== activeTrackIdRef.current) return;

      setDuration(payload.duration ?? 0);
      if (payload.current !== null && !dragging) {
        setCurrent(payload.current);
      }
      setIsPlaying(payload.isPlaying);
      externalAudioStartedRef.current = !payload.ended && !payload.error;

      if (payload.ended) {
        setCurrent(0);
        if (config.autoplayNext) {
          actionsRef.current.nextTrack();
        }
      }

      if (payload.error) {
        console.error(payload.error);
      }
    });

    return () => {
      disposed = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [usesExternalAudio, dragging, config.autoplayNext]);

  useEffect(() => {
    if (currentIndex >= queue.length && queue.length > 0) {
      setCurrentIndex(queue.length - 1);
    }
    if (queue.length === 0 && currentIndex !== -1) {
      setCurrentIndex(-1);
    }
  }, [queue, currentIndex]);

  useEffect(() => {
    if (usesExternalAudio) return;
    if (!shouldAutoPlayRef.current || !currentTrack?.videoId) return;
    const timer = window.setTimeout(() => {
      const p = playerRef.current;
      try {
        p?.playVideo?.();
      } catch {
        // no-op
      }
    }, 140);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, usesExternalAudio]);

  useEffect(() => {
    if (usesExternalAudio) {
      setIsReady(true);
      return;
    }

    if (!videoId) {
      clearPolling();
      setIsReady(false);
      setIsPlaying(false);
      setDuration(0);
      setCurrent(0);
      trackSwitchPendingRef.current = false;
    }

    return () => {
      clearPolling();
      clearForcePlayInterval();
    };
  }, [videoId, usesExternalAudio]);

  useEffect(() => {
    if (usesExternalAudio) return;
    if (!isReady || !videoId) return;

    clearPolling();
    pollRef.current = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;

      try {
        const d = p.getDuration?.() ?? 0;
        if (d && d !== duration) {
          setDuration(d);
          if (currentTrack && currentTrack.duration !== d) {
            setQueue((prev) =>
              prev.map((track, idx) => (idx === currentIndex ? { ...track, duration: d } : track))
            );
          }
        }

        if (!dragging) {
          const t = p.getCurrentTime?.() ?? 0;
          setCurrent(t);
        }
      } catch {
        clearPolling();
      }
    }, 250);

    return clearPolling;
  }, [isReady, videoId, dragging, duration, currentTrack, currentIndex, usesExternalAudio]);

  useEffect(() => {
    if (usesExternalAudio) {
      invokeExternalAudio("set_external_audio_volume", { volume: Math.round(volume) }).catch(() => {});
      invokeExternalAudio("set_external_audio_muted", { muted }).catch(() => {});
      return;
    }

    if (!isReady || !videoId) return;
    applyVolume(volume, muted);
  }, [volume, muted, isReady, videoId, usesExternalAudio]);

  useEffect(() => {
    if (!usesExternalAudio || !isPlaying || dragging) {
      clearExternalClock();
      return;
    }

    let lastTick = Date.now();
    clearExternalClock();
    externalClockRef.current = window.setInterval(() => {
      const now = Date.now();
      const delta = (now - lastTick) / 1000;
      lastTick = now;
      setCurrent((value) => {
        const next = value + delta;
        return duration > 0 ? Math.min(next, duration) : next;
      });
    }, 250);

    return clearExternalClock;
  }, [usesExternalAudio, isPlaying, dragging, duration]);

  const onReady = (e: { target: YouTubePlayer }) => {
    playerRef.current = e.target;
    setIsReady(true);

    if (currentTrack?.videoId) {
      if (shouldAutoPlayRef.current) {
        e.target.loadVideoById?.({ videoId: currentTrack.videoId, startSeconds: 0 });
        e.target.playVideo?.();
        setIsPlaying(true);
      } else {
        e.target.cueVideoById?.({ videoId: currentTrack.videoId, startSeconds: 0 });
      }
    } else {
      const info = extractYoutubeInfo(input.trim());
      if (info.videoId) {
        if (shouldAutoPlayRef.current) {
          e.target.loadVideoById?.({ videoId: info.videoId, startSeconds: info.startSeconds });
          e.target.playVideo?.();
          setIsPlaying(true);
        } else {
          e.target.cueVideoById?.({ videoId: info.videoId, startSeconds: info.startSeconds });
        }
      }
    }

    e.target.setVolume?.(volume);
    if (muted) e.target.mute?.();
  };

  const onStateChange = (e: { data: number }) => {
    if (e.data === 1) {
      shouldAutoPlayRef.current = true;
      trackSwitchPendingRef.current = false;
      clearForcePlayInterval();
      setIsPlaying(true);
    }
    if (e.data === 2) {
      if (!trackSwitchPendingRef.current) {
        shouldAutoPlayRef.current = false;
        setIsPlaying(false);
      }
    }
    if (e.data === 0) {
      shouldAutoPlayRef.current = false;
      trackSwitchPendingRef.current = false;
      clearForcePlayInterval();
      setIsPlaying(false);
      setCurrent(0);
      if (config.autoplayNext) {
        nextTrack();
      }
    }
  };

  const onError = () => {
    setIsPlaying(false);
    clearPolling();
  };

  return {
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
    playTrackImmediately,
    nextTrack,
    previousTrack,
    removeFromQueue,
    clearQueue,
    replaceQueue,
    removeDuplicates,
    startSession,
    togglePlayPause,
    play,
    pause,
    stop,
    seekTo,
    opts,
    usesExternalAudio,
    onReady,
    onStateChange,
    onError,
  };
}
