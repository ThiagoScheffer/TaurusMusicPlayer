import { extractYoutubeInfo } from "../../lib/youtube";
import type { Track } from "../../types/player";

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeVideoIdentity(value: string): string {
  const info = extractYoutubeInfo(value);
  return info.videoId ? `video:${info.videoId.toLowerCase()}` : `url:${normalizeText(value)}`;
}

export function getTrackIdentity(track: Track): string {
  if (track.videoId?.trim()) return normalizeVideoIdentity(track.videoId);
  if (track.sourceUrl?.trim()) return normalizeVideoIdentity(track.sourceUrl);
  return `id:${normalizeText(track.id)}`;
}

export function mergeUniqueTracks(existingTracks: Track[], incomingTracks: Track[]): Track[] {
  const seen = new Set(existingTracks.map(getTrackIdentity));
  const additions: Track[] = [];
  for (const track of incomingTracks) {
    const identity = getTrackIdentity(track);
    if (seen.has(identity)) continue;
    seen.add(identity);
    additions.push({ ...track });
  }
  return [...existingTracks.map((track) => ({ ...track })), ...additions];
}
