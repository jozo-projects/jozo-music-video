import { Socket } from "socket.io-client";

// Interface for Now Playing Data
export interface NowPlayingData {
  video_id: string;
  title: string;
  thumbnail: string;
  author: string;
  duration: number;
  timestamp: number;
  currentTime: number;
}

// Interface for Video Event
export interface VideoEvent {
  event: "play" | "pause" | "seek";
  videoId: string;
  currentTime: number;
}

// Interface for Play Song Event
export interface PlaySongEvent {
  video_id: string;
  title: string;
  thumbnail: string;
  author: string;
  duration: number;
  currentTime: number;
  timestamp: number;
}

// Interface for Video Turned Off Data
export interface VideoTurnedOffData {
  status: string;
}

// Interface for Backup State
export interface BackupState {
  backupUrl: string;
  isLoadingBackup: boolean;
  backupError: boolean;
  backupVideoReady: boolean;
  youtubeError: boolean;
}

// Interface for Video State
export interface VideoState {
  nowPlayingData: NowPlayingData | null;
  currentVideoId: string;
  isPaused: boolean;
  isBuffering: boolean;
}

// Interface for Volume Toast
export interface VolumeToast {
  show: boolean;
  value: number;
}

// Interface for Socket Status
export interface SocketStatus {
  connected: boolean;
  connectionAttempts: number;
}

// Interface for Trending Song
export interface TrendingSong {
  title: string;
  artist: string;
  views: string;
  genre: string;
}

// YouTube Player reference type
export interface YouTubePlayerRef {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted?: () => boolean;
  setVolume: (volume: number) => void;
  getVolume?: () => number;
  getVideoData: () => { video_id: string };
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getAvailableQualityLevels: () => string[];
  setPlaybackQuality: (quality: string) => void;
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  destroy: () => void;
}

// Props for backup video component
export interface BackupVideoProps {
  videoId: string | undefined;
  roomId: string;
  volume: number;
  socket: typeof Socket | null;
  onVideoReady: () => void;
  onVideoEnd: () => void;
}
