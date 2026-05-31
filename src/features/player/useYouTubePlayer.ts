import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Track } from "../../types/player";

export type YouTubePlayer = {
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

export function useYouTubePlayerOpts() {
  return useMemo(
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
}

export function makeTrack(sourceUrl: string, videoId: string): Track {
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

export function useQueueTitleEnrichment(params: {
  queue: Track[];
  setQueue: Dispatch<SetStateAction<Track[]>>;
}) {
  const { queue, setQueue } = params;

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
  }, [queue, setQueue]);
}
