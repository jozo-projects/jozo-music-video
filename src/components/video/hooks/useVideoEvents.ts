/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { PlaySongEvent, VideoEvent, VideoState } from "../types";
import { FALLBACK_VIDEO_ID, SONG_TRANSITION_BUFFER_MS } from "../constants";

const IS_DEV = import.meta.env.DEV || import.meta.env.MODE === "development";
const devLog = (...args: unknown[]) => {
  if (IS_DEV) console.log(...args);
};
const devError = (...args: unknown[]) => {
  if (IS_DEV) console.error(...args);
};

const TIME_UPDATE_INTERVAL_MS = 2500;
const TIME_UPDATE_FORCE_EMIT_MS = 5000;

// Định nghĩa một kiểu dữ liệu cho BackupState
interface BackupState {
  backupUrl: string;
  isLoadingBackup: boolean;
  backupError: boolean;
  backupVideoReady: boolean;
  youtubeError: boolean;
}

// Định nghĩa kiểu cho YouTube Player Ref
interface YouTubePlayerRef {
  loadVideoById: (args: { videoId: string; startSeconds: number }) => void;
  getVideoData: () => { video_id: string };
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (time: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  setPlaybackQuality: (quality: string) => void;
  unMute?: () => void;
}

interface UseVideoEventsProps {
  socket: typeof Socket | null;
  roomId: string;
  videoState: VideoState;
  setVideoState: React.Dispatch<React.SetStateAction<VideoState>>;
  setIsChangingSong: React.Dispatch<React.SetStateAction<boolean>>;
  playerRef: React.RefObject<YouTubePlayerRef>;
  backupVideoRef: React.RefObject<HTMLVideoElement>;
  handleBackupVideoEnd: () => void; // Giữ lại vì có thể cần trong tương lai
  backupState: BackupState;
  setBackupState: React.Dispatch<React.SetStateAction<BackupState>>;
  onSongEnded?: () => void; // Thêm callback tùy chọn khi bài hát kết thúc
}

export function useVideoEvents({
  socket,
  roomId,
  videoState,
  setVideoState,
  setIsChangingSong,
  playerRef,
  backupVideoRef,
  handleBackupVideoEnd, // Giữ lại để không phá vỡ API của hook
  backupState,
  setBackupState,
  onSongEnded,
}: UseVideoEventsProps) {
  // Create refs to store the latest values without triggering re-renders
  const videoStateRef = useRef(videoState);
  const roomIdRef = useRef(roomId);
  const backupStateRef = useRef(backupState);
  const socketRef = useRef(socket);

  // Thêm ref để lưu trữ thời gian gần nhất đã gửi, đặt ở đây để không gặp lỗi
  const lastTimeRef = useRef<{
    currentTime: number;
    isPlaying: boolean;
    lastEmitTime?: number;
  }>({ currentTime: 0, isPlaying: false });

  const deferredFallbackLoadTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const cancelDeferredFallbackLoad = useCallback(() => {
    if (deferredFallbackLoadTimerRef.current !== null) {
      clearTimeout(deferredFallbackLoadTimerRef.current);
      deferredFallbackLoadTimerRef.current = null;
    }
  }, []);

  // Update refs when values change
  useEffect(() => {
    videoStateRef.current = videoState;
    roomIdRef.current = roomId;
    backupStateRef.current = backupState;
    socketRef.current = socket;
  }, [videoState, roomId, backupState, socket]);

  // Handle current song event from server
  useEffect(() => {
    if (!socket) return;

    // Handle current song event after reconnect
    const handleCurrentSong = (data: PlaySongEvent) => {
      devLog("Received current song after reconnect:", data);

      if (!data || !data.video_id) return;

      cancelDeferredFallbackLoad();

      // Check if song is different from current
      if (
        !videoStateRef.current.nowPlayingData?.video_id ||
        videoStateRef.current.nowPlayingData.video_id !== data.video_id
      ) {
        setIsChangingSong(true);

        // Reset lastTimeRef để bắt đầu emit ngay lập tức
        lastTimeRef.current = { currentTime: 0, isPlaying: false };

        setVideoState((prev) => ({
          ...prev,
          nowPlayingData: {
            ...data,
            currentTime: data.currentTime || 0,
          },
          currentVideoId: data.video_id,
          isBuffering: true,
          isPaused: false,
        }));

        // Reset backup states
        setBackupState({
          backupUrl: "",
          isLoadingBackup: false,
          backupError: false,
          backupVideoReady: false,
          youtubeError: false,
        });

        if (playerRef.current?.loadVideoById) {
          // Thêm mới: Đảm bảo player không bị mute trước khi load video mới
          try {
            playerRef.current.unMute?.();
          } catch (e) {
            devError("Error unmuting during current song update:", e);
          }

          // Calculate current time based on timestamp
          const elapsedTime = (Date.now() - data.timestamp) / 1000;
          const startTime = data.currentTime + elapsedTime;

          playerRef.current.loadVideoById({
            videoId: data.video_id,
            startSeconds: startTime,
          });
        }
      }
    };

    socket.on("current_song", handleCurrentSong);

    return () => {
      socket.off("current_song", handleCurrentSong);
      cancelDeferredFallbackLoad();
    };
  }, [socket, cancelDeferredFallbackLoad]);

  // Handle play song and video events
  useEffect(() => {
    if (!socket) return;

    // Handle play_song event
    const handlePlaySong = (data: PlaySongEvent) => {
      devLog("Received play song:", data);
      cancelDeferredFallbackLoad();
      setIsChangingSong(true);

      // Reset lastTimeRef để bắt đầu emit ngay lập tức
      lastTimeRef.current = { currentTime: 0, isPlaying: false };

      setVideoState((prev) => ({
        ...prev,
        nowPlayingData: {
          ...data,
          currentTime: 0, // Reset currentTime for new song
        },
        currentVideoId: data.video_id,
        isBuffering: true,
        isPaused: false,
      }));

      // Reset backup states
      setBackupState({
        backupUrl: "",
        isLoadingBackup: false,
        backupError: false,
        backupVideoReady: false,
        youtubeError: false,
      });

      if (playerRef.current?.loadVideoById) {
        // Thêm mới: Đảm bảo player không bị mute trước khi load video mới
        try {
          playerRef.current.unMute?.();
          devLog("Unmuting player before loading new song");
        } catch (e) {
          devError("Error unmuting during play song:", e);
        }

        playerRef.current.loadVideoById({
          videoId: data.video_id,
          startSeconds: 0, // Start from beginning
        });
      }
    };

    // Handle playback_event
    const handlePlaybackEvent = (data: VideoEvent) => {
      devLog("Received playback event:", data);

      // Handle for backup video
      if (backupState.backupUrl && backupVideoRef.current) {
        switch (data.event) {
          case "play":
            devLog("Playing backup video at time:", data.currentTime);
            backupVideoRef.current.currentTime = data.currentTime;
            backupVideoRef.current
              .play()
              .then(() => {
                setVideoState((prev) => ({ ...prev, isPaused: false }));
                devLog(
                  "Backup video playing at:",
                  backupVideoRef.current?.currentTime
                );
              })
              .catch((e) => devError("Error playing backup video:", e));
            break;
          case "pause":
            devLog("Pausing backup video at time:", data.currentTime);
            backupVideoRef.current.currentTime = data.currentTime;
            backupVideoRef.current.pause();
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            break;
          case "seek":
            devLog("Seeking backup video to:", data.currentTime);
            backupVideoRef.current.currentTime = data.currentTime;
            break;
        }
        return;
      }

      // Handle for YouTube player
      if (playerRef.current) {
        switch (data.event) {
          case "play":
            devLog("Playing YouTube video at time:", data.currentTime);

            playerRef.current.seekTo(data.currentTime, true);

            try {
              playerRef.current.unMute?.();
            } catch (e) {
              devError("Error unmuting during play event:", e);
            }

            playerRef.current.playVideo();
            setVideoState((prev) => ({ ...prev, isPaused: false }));

            setTimeout(() => {
              try {
                if (playerRef.current) {
                  const currentTime = playerRef.current.getCurrentTime();
                  const expectedTime = data.currentTime + 0.2;
                  const timeDiff = Math.abs(currentTime - expectedTime);

                  if (timeDiff > 1) {
                    devLog(
                      `Correcting sync: expected ${expectedTime}, got ${currentTime}`
                    );
                    playerRef.current.seekTo(expectedTime, true);
                  }

                  playerRef.current.unMute?.();
                }
              } catch {
                // Ignore errors in sync correction
              }
            }, 200);
            break;

          case "pause":
            devLog("Pausing YouTube video at time:", data.currentTime);
            playerRef.current.seekTo(data.currentTime, true);
            playerRef.current.pauseVideo();
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            break;

          case "seek":
            devLog("Seeking YouTube video to:", data.currentTime);
            playerRef.current.seekTo(data.currentTime, true);
            break;
        }
      }
    };

    // Handle now_playing_cleared event
    const handleNowPlayingCleared = () => {
      cancelDeferredFallbackLoad();

      setVideoState((prev) => ({
        ...prev,
        nowPlayingData: null,
        currentVideoId: "",
      }));

      deferredFallbackLoadTimerRef.current = setTimeout(() => {
        deferredFallbackLoadTimerRef.current = null;
        if (
          !videoStateRef.current.nowPlayingData?.video_id &&
          playerRef.current?.loadVideoById
        ) {
          playerRef.current.loadVideoById({
            videoId: FALLBACK_VIDEO_ID,
            startSeconds: 0,
          });
        }
      }, SONG_TRANSITION_BUFFER_MS);
    };

    // Register event listeners
    socket.on("play_song", handlePlaySong);
    socket.on("video_event", handlePlaybackEvent);
    socket.on("now_playing_cleared", handleNowPlayingCleared);

    return () => {
      socket.off("play_song", handlePlaySong);
      socket.off("video_event", handlePlaybackEvent);
      socket.off("now_playing_cleared", handleNowPlayingCleared);
      cancelDeferredFallbackLoad();
    };
  }, [socket, backupState.backupUrl, cancelDeferredFallbackLoad]);

  // Video end handler
  const handleVideoEnd = useCallback(() => {
    const socket = socketRef.current;
    const videoState = videoStateRef.current;
    const roomId = roomIdRef.current;
    const backupState = backupStateRef.current;

    if (!videoState.nowPlayingData || !socket) {
      devLog("Cannot handle video end: missing data or socket");
      return;
    }

    try {
      devLog("Video ended: sending song_ended event");

      if (
        backupState.backupUrl &&
        backupState.backupVideoReady &&
        backupVideoRef.current
      ) {
        // For backup video, handle separately to avoid double-events
        // Logic is in the component
        handleBackupVideoEnd();
      } else {
        // For YouTube player
        socket.emit("song_ended", {
          roomId,
          videoId: videoState.nowPlayingData.video_id,
        });
      }

      // Gọi callback nếu được cung cấp
      if (onSongEnded) {
        onSongEnded();
      }
    } catch (e) {
      devError("Error handling video end:", e);
    }
  }, [
    backupVideoRef,
    playerRef,
    handleBackupVideoEnd,
    onSongEnded,
  ]);

  // Handle time updates - cải thiện logic sync và giảm overhead
  const handleTimeUpdate = useCallback(() => {
    const socket = socketRef.current;
    const videoState = videoStateRef.current;
    const roomId = roomIdRef.current;
    const backupState = backupStateRef.current;

    if (!socket || !videoState.nowPlayingData) return;

    // Handle for backup video
    if (backupState.backupUrl && backupVideoRef.current) {
      const currentTime = backupVideoRef.current.currentTime;
      const rawDuration = backupVideoRef.current.duration;
      const duration = rawDuration ? Math.max(0, rawDuration - 1.5) : 0;
      const isPlaying = !backupVideoRef.current.paused;

      if (currentTime >= duration) {
        if (typeof handleBackupVideoEnd === "function") {
          handleBackupVideoEnd();
        } else {
          socket.emit("song_ended", {
            roomId,
            videoId: videoState.currentVideoId,
          });
        }
        return;
      }

      const timeDiff = Math.abs(currentTime - lastTimeRef.current.currentTime);
      const stateChanged = isPlaying !== lastTimeRef.current.isPlaying;
      const threshold = stateChanged ? 0.3 : 0.8;

      const timeSinceLastEmit =
        Date.now() - (lastTimeRef.current.lastEmitTime || 0);
      const shouldForceEmit = timeSinceLastEmit > TIME_UPDATE_FORCE_EMIT_MS;

      if (
        (timeDiff >= threshold || stateChanged || shouldForceEmit) &&
        currentTime !== undefined &&
        duration &&
        !isNaN(currentTime) &&
        !isNaN(duration)
      ) {
        socket.emit("time_update", {
          roomId,
          videoId: videoState.currentVideoId,
          currentTime,
          seconds: currentTime,
          duration,
          isPlaying,
        });

        lastTimeRef.current = {
          currentTime,
          isPlaying,
          lastEmitTime: Date.now(),
        };
      }
      return;
    }

    if (!playerRef.current) return;

    try {
      if (
        !playerRef.current.getVideoData ||
        !playerRef.current.getCurrentTime ||
        !playerRef.current.getDuration
      ) {
        return;
      }

      const videoData = playerRef.current.getVideoData();
      if (!videoData || !videoData.video_id) return;

      const currentTime = playerRef.current.getCurrentTime();
      const duration = playerRef.current.getDuration();

      if (
        currentTime === undefined ||
        duration === undefined ||
        currentTime < 0 ||
        duration <= 0 ||
        isNaN(currentTime) ||
        isNaN(duration)
      ) {
        return;
      }

      if (currentTime >= duration) {
        socket.emit("song_ended", {
          roomId,
          videoId: videoData.video_id,
        });
        return;
      }

      const timeDiff = Math.abs(currentTime - lastTimeRef.current.currentTime);
      const stateChanged =
        !videoState.isPaused !== lastTimeRef.current.isPlaying;
      const threshold = stateChanged ? 0.3 : 0.8;

      const timeSinceLastEmit =
        Date.now() - (lastTimeRef.current.lastEmitTime || 0);
      const shouldForceEmit = timeSinceLastEmit > TIME_UPDATE_FORCE_EMIT_MS;

      if (timeDiff >= threshold || stateChanged || shouldForceEmit) {
        socket.emit("time_update", {
          roomId,
          videoId: videoData.video_id,
          currentTime,
          seconds: currentTime,
          duration,
          isPlaying: !videoState.isPaused,
        });

        lastTimeRef.current = {
          currentTime,
          isPlaying: !videoState.isPaused,
          lastEmitTime: Date.now(),
        };
      }
    } catch (error) {
      devError("Error accessing YouTube player methods:", error);
    }
  }, [backupVideoRef, playerRef, handleBackupVideoEnd]);

  // Set up time update interval ổn định, đủ thưa để không spam postMessage vào iframe.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const intervalId = window.setInterval(() => {
      handleTimeUpdate();
    }, TIME_UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [handleTimeUpdate]);

  useEffect(() => {
    lastTimeRef.current = { currentTime: 0, isPlaying: false };
  }, [videoState.nowPlayingData?.video_id, backupState.backupUrl]);

  // Video state change handler
  const handleStateChange = useCallback(
    (event: { data: number; target?: any }) => {
      const socket = socketRef.current;
      const roomId = roomIdRef.current;

      if (!playerRef.current || !socket) return;

      type YouTubePlayerState = {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };

      const YT: { PlayerState: YouTubePlayerState } = (window as any).YT;
      devLog("YouTube State Change:", event.data);

      try {
        if (event.data === YT.PlayerState.PLAYING) {
          setIsChangingSong(false);
        }

        switch (event.data) {
          case YT.PlayerState.PLAYING:
            setVideoState((prev) => ({
              ...prev,
              isBuffering: false,
              isPaused: false,
            }));

            socket.emit("video_event", {
              roomId,
              event: "play",
              videoId: playerRef.current.getVideoData().video_id,
              currentTime: playerRef.current.getCurrentTime(),
              seconds: playerRef.current.getCurrentTime(),
            });
            break;

          case YT.PlayerState.BUFFERING:
            setVideoState((prev) => ({ ...prev, isBuffering: true }));
            break;

          case YT.PlayerState.PAUSED:
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            socket.emit("video_event", {
              roomId,
              event: "pause",
              videoId: playerRef.current.getVideoData().video_id,
              currentTime: playerRef.current.getCurrentTime(),
              seconds: playerRef.current.getCurrentTime(),
            });
            break;

          case YT.PlayerState.ENDED:
            handleVideoEnd();
            break;
        }
      } catch (error) {
        devError("Error in handleStateChange:", error);
      }
    },
    [setIsChangingSong, setVideoState, handleVideoEnd]
  );

  return {
    handleVideoEnd,
    handleTimeUpdate,
    handleStateChange, // Export để sử dụng trong VideoPlayer.tsx
  };
}
