import { useEffect, useRef, useState } from "react";
import { extractYoutubeInfo } from "../../lib/youtube";
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

export function usePlayer(config: UsePlayerConfig) {
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
  const actionsRef = useRef({
    togglePlayPause: () => {},
    nextTrack: () => {},
    previousTrack: () => {},
    toggleMuted: () => {},
  });

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const videoId = currentTrack?.videoId ?? null;
  const opts = useYouTubePlayerOpts();

  const clearPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
    }
    pollRef.current = null;
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

    const p = playerRef.current;
    if (p?.loadVideoById) {
      p.loadVideoById({ videoId: track.videoId, startSeconds: 0 });
      setIsPlaying(true);
    }
  };

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
    if (p?.loadVideoById) {
      p.loadVideoById({ videoId: info.videoId, startSeconds: info.startSeconds });
      setIsPlaying(true);
      setCurrent(0);
    }
  };

  const play = () => {
    const p = playerRef.current;
    if (!p?.playVideo || !currentTrack) return;
    p.playVideo();
    setIsPlaying(true);
  };

  const pause = () => {
    const p = playerRef.current;
    if (!p?.pauseVideo) return;
    p.pauseVideo();
    setIsPlaying(false);
  };

  const stop = () => {
    const p = playerRef.current;
    try {
      p?.stopVideo?.();
    } catch {
      // no-op
    }
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
    p?.seekTo?.(0, true);
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

  const startSession = (session: Session) => {
    const sessionQueue = session.queue.map((track) => ({ ...track }));
    setQueue(sessionQueue);
    setCurrentIndex(sessionQueue.length > 0 ? 0 : -1);
    setVolume(session.volume);
    setMuted(session.muted);
    setCurrent(0);
    setDuration(sessionQueue[0]?.duration ?? 0);
    setIsPlaying(false);

    const p = playerRef.current;
    if (p?.cueVideoById && sessionQueue.length > 0) {
      p.cueVideoById({ videoId: sessionQueue[0].videoId, startSeconds: 0 });
    }
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
    if (currentIndex >= queue.length && queue.length > 0) {
      setCurrentIndex(queue.length - 1);
    }
    if (queue.length === 0 && currentIndex !== -1) {
      setCurrentIndex(-1);
    }
  }, [queue, currentIndex]);

  useEffect(() => {
    if (!videoId) {
      clearPolling();
      setIsReady(false);
      setIsPlaying(false);
      setDuration(0);
      setCurrent(0);
    }

    return () => {
      clearPolling();
    };
  }, [videoId]);

  useEffect(() => {
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
  }, [isReady, videoId, dragging, duration, currentTrack, currentIndex]);

  useEffect(() => {
    if (!isReady || !videoId) return;
    applyVolume(volume, muted);
  }, [volume, muted, isReady, videoId]);

  const onReady = (e: { target: YouTubePlayer }) => {
    playerRef.current = e.target;
    setIsReady(true);

    if (currentTrack?.videoId) {
      e.target.cueVideoById?.({ videoId: currentTrack.videoId, startSeconds: 0 });
    } else {
      const info = extractYoutubeInfo(input.trim());
      if (info.videoId) {
        e.target.cueVideoById?.({ videoId: info.videoId, startSeconds: info.startSeconds });
      }
    }

    e.target.setVolume?.(volume);
    if (muted) e.target.mute?.();
  };

  const onStateChange = (e: { data: number }) => {
    if (e.data === 1) setIsPlaying(true);
    if (e.data === 2) setIsPlaying(false);
    if (e.data === 0) {
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
    removeDuplicates,
    startSession,
    togglePlayPause,
    play,
    pause,
    stop,
    seekTo,
    opts,
    onReady,
    onStateChange,
    onError,
  };
}
