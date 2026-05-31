export interface YouTubeVideoInfo {
  videoId: string | null;
  startSeconds: number;
}

export interface Track {
  id: string;
  title: string;
  artist?: string;
  sourceType: "youtube";
  sourceUrl: string;
  videoId: string;
  duration?: number;
  addedAt: number;
}

export interface Session {
  id: string;
  name: string;
  description?: string;
  mode: "coding" | "study" | "reading" | "deep-work" | "night" | "custom";
  queue: Track[];
  volume: number;
  muted: boolean;
  shuffle: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FocusMode {
  id: string;
  name: string;
  description?: string;
  defaultVolume: number;
  preferredSessionId?: string;
  shuffle: boolean;
  tags: string[];
  themeIntensity: "calm" | "neutral" | "intense";
}

export type BlacklistEntryType = "video" | "category" | "genre" | "keyword";

export interface BlacklistEntry {
  id: string;
  type: BlacklistEntryType;
  value: string;
  createdAt: number;
}

export interface PlayerState {
  input: string;
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  isReady: boolean;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  duration: number;
  current: number;
  dragging: boolean;
}
