import type { BackupState, NowPlayingData } from "./types";

/** A queue entry can replay the same video; ID alone is not a playback identity. */
export function songPlaybackKey(song: Pick<NowPlayingData, "video_id" | "timestamp">): string {
  return `${song.video_id}:${song.timestamp}`;
}

export function transitionBackupState(
  previous: BackupState,
  url: string,
): { state: BackupState; replayMountedVideo: boolean } {
  const replayMountedVideo = Boolean(url && previous.backupUrl === url && previous.backupVideoReady);
  return {
    state: {
      backupUrl: url,
      isLoadingBackup: false,
      backupError: false,
      // The mounted <video> will not fire ready again when its URL is unchanged.
      backupVideoReady: replayMountedVideo,
      youtubeError: Boolean(url),
    },
    replayMountedVideo,
  };
}
