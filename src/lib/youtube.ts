import type { YouTubeVideoInfo } from "../types/player";

export function extractYoutubeInfo(urlOrId: string): YouTubeVideoInfo {
  const raw = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return { videoId: raw, startSeconds: 0 };
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw)
    ? raw
    : /^(www\.)?(youtube\.com|music\.youtube\.com|m\.youtube\.com|youtu\.be)\//i.test(raw)
      ? `https://${raw}`
      : raw;

  try {
    const u = new URL(withProtocol);
    const t = u.searchParams.get("t") || u.searchParams.get("start") || "0";
    const startSeconds = Number(String(t).replace("s", "")) || 0;

    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0] || null;
      return { videoId: id, startSeconds };
    }

    const v = u.searchParams.get("v");
    if (v) {
      return { videoId: v, startSeconds };
    }

    const parts = u.pathname.split("/").filter(Boolean);
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) {
      return { videoId: parts[shortsIdx + 1], startSeconds };
    }

    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1]) {
      return { videoId: parts[embedIdx + 1], startSeconds };
    }

    const liveIdx = parts.indexOf("live");
    if (liveIdx >= 0 && parts[liveIdx + 1]) {
      return { videoId: parts[liveIdx + 1], startSeconds };
    }
  } catch {
    // invalid input format; fall back to regex parsing below
  }

  const fallback = raw.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|music\.youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/
  );
  if (fallback?.[1]) {
    return { videoId: fallback[1], startSeconds: 0 };
  }

  return { videoId: null, startSeconds: 0 };
}
