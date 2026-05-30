import { useEffect, useMemo, useRef, useState } from "react";
import { extractYoutubeInfo } from "../../lib/youtube";
import type { Session, Track } from "../../types/player";

const DEFAULT_URL = "https://www.youtube.com/watch?v=0psoEvF8XIk";
const STORAGE_KEYS = {
  volume: "taurus.volume",
  muted: "taurus.muted",
  input: "taurus.input",
  queue: "taurus.queue",
  currentIndex: "taurus.currentIndex",
} as const;

function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function readString(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function readQueue(): Track[] {
  const raw = localStorage.getItem(STORAGE_KEYS.queue);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is Track => {
      if (!item || typeof item !== "object") return false;
      const t = item as Partial<Track>;
      return (
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        t.sourceType === "youtube" &&
        typeof t.sourceUrl === "string" &&
        typeof t.videoId === "string" &&
        typeof t.addedAt === "number"
      );
    });
  } catch {
    return [];
  }
}

function makeTrack(sourceUrl: string, videoId: string): Track {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: videoId,
    sourceType: "youtube",
    sourceUrl,
    videoId,
    addedAt: Date.now(),
  };
}

async function fetchYoutubeTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim().length > 0 ? data.title.trim() : null;
  } catch {
    return null;
  }
}

type YouTubePlayer = {
  loadVideoById?: (args: { videoId: string; startSeconds?: number }) => void;
  cueVideoById?: (args: { videoId: string; startSeconds?: number }) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  setVolume?: (v: number) => void;
  mute?: () => void;
  unMute?: () => void;
  getDuration?: () => number;
  getCurrentTime?: () => number;
  getIframe?: () => HTMLIFrameElement | undefined;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
};

interface UsePlayerConfig {
  defaultVolume: number;
  autoplayNext: boolean;
  rememberLastTrack: boolean;
  skipBlacklistedTracks: boolean;
  blacklistedVideoIds: string[];
}

export function usePlayer(config: UsePlayerConfig) {
  const storedInput = readString(STORAGE_KEYS.input, DEFAULT_URL);
  const initialQueue = config.rememberLastTrack ? readQueue() : [];
  const initialIndex = config.rememberLastTrack
    ? Math.max(-1, Math.min(readNumber(STORAGE_KEYS.currentIndex, initialQueue.length > 0 ? 0 : -1), initialQueue.length - 1))
    : -1;

  const [input, setInput] = useState(storedInput);
  const [queue, setQueue] = useState<Track[]>(initialQueue);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(readNumber(STORAGE_KEYS.volume, config.defaultVolume));
  const [muted, setMuted] = useState(readBoolean(STORAGE_KEYS.muted, false));
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

  const opts = useMemo(
    () => ({
      width: "0",
      height: "0",
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
    }),
    []
  );

  const clearPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
    }
    pollRef.current = null;
  };

  const isBlacklisted = (track: Track | null) =>
    !!track && config.skipBlacklistedTracks && config.blacklistedVideoIds.includes(track.videoId);

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
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  actionsRef.current.togglePlayPause = togglePlayPause;
  actionsRef.current.nextTrack = nextTrack;
  actionsRef.current.previousTrack = previousTrack;
  actionsRef.current.toggleMuted = toggleMuted;

  useEffect(() => {
    if (currentIndex >= queue.length && queue.length > 0) {
      setCurrentIndex(queue.length - 1);
    }
    if (queue.length === 0 && currentIndex !== -1) {
      setCurrentIndex(-1);
    }
  }, [queue, currentIndex]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.volume, String(volume));
  }, [volume]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.muted, String(muted));
  }, [muted]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.input, input);
  }, [input]);

  useEffect(() => {
    if (config.rememberLastTrack) {
      localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(queue));
    }
  }, [queue]);

  useEffect(() => {
    const pending = queue.filter((t) => t.title === t.videoId);
    if (pending.length === 0) return;

    let cancelled = false;
    Promise.all(
      pending.map(async (track) => ({
        id: track.id,
        title: await fetchYoutubeTitle(track.videoId),
      }))
    ).then((updates) => {
      if (cancelled) return;
      const titleMap = new Map(
        updates
          .filter((u): u is { id: string; title: string } => !!u.title)
          .map((u) => [u.id, u.title])
      );
      if (titleMap.size === 0) return;

      setQueue((prev) =>
        prev.map((track) => {
          const title = titleMap.get(track.id);
          return title ? { ...track, title } : track;
        })
      );
    });

    return () => {
      cancelled = true;
    };
  }, [queue]);

  useEffect(() => {
    if (config.rememberLastTrack) {
      localStorage.setItem(STORAGE_KEYS.currentIndex, String(currentIndex));
    }
  }, [currentIndex]);

  useEffect(() => {
    if (!config.rememberLastTrack) {
      localStorage.removeItem(STORAGE_KEYS.queue);
      localStorage.removeItem(STORAGE_KEYS.currentIndex);
    }
  }, [config.rememberLastTrack]);

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
              prev.map((track, idx) =>
                idx === currentIndex ? { ...track, duration: d } : track
              )
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

  useEffect(() => {
    let unlistenFns: Array<() => void> = [];

    const setupHotkeyListeners = async () => {
      try {
        const tauriEvent = (window as Window & {
          __TAURI__?: {
            event?: {
              listen?: (
                event: string,
                cb: () => void
              ) => Promise<() => void>;
            };
          };
        }).__TAURI__?.event;

        const listen = tauriEvent?.listen;
        if (!listen) return;

        const unlistenPlayPause = await listen("global-shortcut://play-pause", () => {
          actionsRef.current.togglePlayPause();
        });
        const unlistenNext = await listen("global-shortcut://next-track", () => {
          actionsRef.current.nextTrack();
        });
        const unlistenPrevious = await listen("global-shortcut://previous-track", () => {
          actionsRef.current.previousTrack();
        });
        const unlistenMute = await listen("global-shortcut://toggle-mute", () => {
          actionsRef.current.toggleMuted();
        });

        unlistenFns = [unlistenPlayPause, unlistenNext, unlistenPrevious, unlistenMute];
      } catch {
        // Browser-only dev mode: Tauri API is unavailable.
      }
    };

    setupHotkeyListeners();

    return () => {
      for (const unlisten of unlistenFns) {
        try {
          unlisten();
        } catch {
          // no-op
        }
      }
    };
  }, []);

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
