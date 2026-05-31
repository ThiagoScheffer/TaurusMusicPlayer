import { extractYoutubeInfo } from "../../lib/youtube";
import type { BlacklistEntry, Track } from "../../types/player";

interface BlacklistConfig {
  skipBlacklistedTracks: boolean;
  blacklistedVideoIds: string[];
  blacklistEntries: BlacklistEntry[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeVideoIdOrLink(value: string): string {
  const info = extractYoutubeInfo(value);
  return info.videoId ? info.videoId.toLowerCase() : normalizeText(value);
}

function trackIncludesText(track: Track, value: string): boolean {
  const needle = normalizeText(value);
  if (!needle) return false;
  const haystack = [track.title, track.artist, track.sourceUrl, track.videoId].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(needle);
}

function matchesEntry(track: Track, entry: BlacklistEntry): boolean {
  switch (entry.type) {
    case "video":
      return (
        normalizeVideoIdOrLink(track.videoId) === normalizeVideoIdOrLink(entry.value) ||
        normalizeVideoIdOrLink(track.sourceUrl) === normalizeVideoIdOrLink(entry.value)
      );
    case "category":
    case "genre":
    case "keyword":
      return trackIncludesText(track, entry.value);
    default:
      return false;
  }
}

export function isTrackBlacklisted(track: Track | null, config: BlacklistConfig): boolean {
  if (!track || !config.skipBlacklistedTracks) return false;

  const blockedById = config.blacklistedVideoIds.some(
    (id) => normalizeVideoIdOrLink(id) === normalizeVideoIdOrLink(track.videoId)
  );
  if (blockedById) return true;

  return config.blacklistEntries.some((entry) => matchesEntry(track, entry));
}
