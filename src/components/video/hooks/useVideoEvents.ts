/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { PlaySongEvent, VideoEvent, VideoState } from "../types";
import { FALLBACK_VIDEO_ID } from "../constants";

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
      console.log("Received current song after reconnect:", data);

      if (!data || !data.video_id) return;

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
            console.error("Error unmuting during current song update:", e);
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
    };
  }, [socket]);

  // Handle play song and video events
  useEffect(() => {
    if (!socket) return;

    // Handle play_song event
    const handlePlaySong = (data: PlaySongEvent) => {
      console.log("Received play song:", data);
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
          console.log("Unmuting player before loading new song");
        } catch (e) {
          console.error("Error unmuting during play song:", e);
        }

        playerRef.current.loadVideoById({
          videoId: data.video_id,
          startSeconds: 0, // Start from beginning
        });
      }
    };

    // Handle playback_event
    const handlePlaybackEvent = (data: VideoEvent) => {
      console.log("Received playback event:", data);

      // Handle for backup video
      if (backupState.backupUrl && backupVideoRef.current) {
        switch (data.event) {
          case "play":
            console.log("Playing backup video at time:", data.currentTime);
            // Immediate sync - set time first, then play
            backupVideoRef.current.currentTime = data.currentTime;
            backupVideoRef.current
              .play()
              .then(() => {
                setVideoState((prev) => ({ ...prev, isPaused: false }));
                console.log(
                  "Backup video playing at:",
                  backupVideoRef.current?.currentTime
                );
              })
              .catch((e) => console.error("Error playing backup video:", e));
            break;
          case "pause":
            console.log("Pausing backup video at time:", data.currentTime);
            // Sync time before pausing
            backupVideoRef.current.currentTime = data.currentTime;
            backupVideoRef.current.pause();
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            break;
          case "seek":
            console.log("Seeking backup video to:", data.currentTime);
            backupVideoRef.current.currentTime = data.currentTime;
            break;
        }
        return;
      }

      // Handle for YouTube player
      if (playerRef.current) {
        switch (data.event) {
          case "play":
            console.log("Playing YouTube video at time:", data.currentTime);

            // Immediate sync - seek first, then play
            playerRef.current.seekTo(data.currentTime, true);

            // Đảm bảo video không bị mute trước khi phát
            try {
              playerRef.current.unMute?.();
            } catch (e) {
              console.error("Error unmuting during play event:", e);
            }

            playerRef.current.playVideo();
            setVideoState((prev) => ({ ...prev, isPaused: false }));

            // Double-check sync after a brief delay
            setTimeout(() => {
              try {
                if (playerRef.current) {
                  const currentTime = playerRef.current.getCurrentTime();
                  const expectedTime = data.currentTime + 0.2; // Account for 200ms delay
                  const timeDiff = Math.abs(currentTime - expectedTime);

                  if (timeDiff > 1) {
                    // If more than 1 second off
                    console.log(
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
            console.log("Pausing YouTube video at time:", data.currentTime);
            // Sync time before pausing
            playerRef.current.seekTo(data.currentTime, true);
            playerRef.current.pauseVideo();
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            break;

          case "seek":
            console.log("Seeking YouTube video to:", data.currentTime);
            playerRef.current.seekTo(data.currentTime, true);
            break;
        }
      }
    };

    // Handle now_playing_cleared event
    const handleNowPlayingCleared = () => {
      setVideoState((prev) => ({
        ...prev,
        nowPlayingData: null,
        currentVideoId: "",
      }));

      // Load fallback video
      if (playerRef.current?.loadVideoById) {
        playerRef.current.loadVideoById({
          videoId: FALLBACK_VIDEO_ID,
          startSeconds: 0,
        });
      }
    };

    // Register event listeners
    socket.on("play_song", handlePlaySong);
    socket.on("video_event", handlePlaybackEvent);
    socket.on("now_playing_cleared", handleNowPlayingCleared);

    return () => {
      socket.off("play_song", handlePlaySong);
      socket.off("video_event", handlePlaybackEvent);
      socket.off("now_playing_cleared", handleNowPlayingCleared);
    };
  }, [socket, backupState.backupUrl]);

  // Video end handler
  const handleVideoEnd = useCallback(() => {
    const socket = socketRef.current;
    const videoState = videoStateRef.current;
    const roomId = roomIdRef.current;
    const backupState = backupStateRef.current;

    if (!videoState.nowPlayingData || !socket) {
      console.log("Cannot handle video end: missing data or socket");
      return;
    }

    try {
      console.log("Video ended: sending song_ended event");

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
      console.error("Error handling video end:", e);
    }
  }, [
    backupVideoRef,
    playerRef,
    handleBackupVideoEnd,
    onSongEnded, // Thêm dependency
  ]);

  // Handle time updates - cải thiện logic sync và giảm overhead
  const handleTimeUpdate = useCallback(() => {
    const socket = socketRef.current;
    const videoState = videoStateRef.current;
    const roomId = roomIdRef.current;
    const backupState = backupStateRef.current;

    // Early returns để giảm overhead
    if (!socket || !videoState.nowPlayingData) {
      console.log("[TIME_UPDATE] Skipping: no socket or nowPlayingData");
      return;
    }
    // Bỏ check isPaused để luôn emit time_update khi video đang chạy

    // Handle for backup video
    if (backupState.backupUrl && backupVideoRef.current) {
      const currentTime = backupVideoRef.current.currentTime;
      const rawDuration = backupVideoRef.current.duration;
      const duration = rawDuration ? Math.max(0, rawDuration - 1.5) : 0;
      const isPlaying = !backupVideoRef.current.paused;

      console.log(
        `[BACKUP] Current state: time=${currentTime}, duration=${duration}, playing=${isPlaying}, isPaused=${videoState.isPaused}`
      );

      // Early return nếu video đã kết thúc
      if (currentTime >= duration) {
        // Sử dụng handleBackupVideoEnd nếu đã đến cuối video
        if (typeof handleBackupVideoEnd === "function") {
          handleBackupVideoEnd();
        } else {
          socket.emit("song_ended", {
            roomId,
            videoId: videoState.currentVideoId,
          });
        }
        return; // Không cần xử lý thêm
      }

      // Smart throttling - chỉ emit khi thực sự cần thiết
      const timeDiff = Math.abs(currentTime - lastTimeRef.current.currentTime);
      const stateChanged = isPlaying !== lastTimeRef.current.isPlaying;

      // Giảm threshold xuống để emit thường xuyên hơn
      const threshold = stateChanged ? 0.3 : 0.8; // Giảm từ 0.5/1.0 xuống 0.3/0.8

      // Force emit mỗi 3 giây để đảm bảo sync
      const timeSinceLastEmit =
        Date.now() - (lastTimeRef.current.lastEmitTime || 0);
      const shouldForceEmit = timeSinceLastEmit > 3000;

      if (
        (timeDiff >= threshold || stateChanged || shouldForceEmit) &&
        currentTime !== undefined &&
        duration &&
        !isNaN(currentTime) &&
        !isNaN(duration)
      ) {
        console.log(
          `[BACKUP] Emitting time_update: ${currentTime}/${duration}, playing: ${isPlaying}, reason: ${
            shouldForceEmit ? "force" : stateChanged ? "state" : "time"
          }`
        );

        socket.emit("time_update", {
          roomId,
          videoId: videoState.currentVideoId,
          currentTime,
          duration,
          isPlaying,
        });

        // Cập nhật thời gian và trạng thái đã gửi
        lastTimeRef.current = {
          currentTime,
          isPlaying,
          lastEmitTime: Date.now(),
        };
      } else {
        console.log(
          `[BACKUP] Skipping emit: timeDiff=${timeDiff.toFixed(
            2
          )}, threshold=${threshold}, stateChanged=${stateChanged}, shouldForceEmit=${shouldForceEmit}`
        );
      }
      return;
    }

    // Handle for YouTube player
    if (!playerRef.current) {
      console.log("[YOUTUBE] Skipping: no playerRef");
      return;
    }

    try {
      // Kiểm tra phương thức có tồn tại không - early return để tránh overhead
      if (
        !playerRef.current.getVideoData ||
        !playerRef.current.getCurrentTime ||
        !playerRef.current.getDuration
      ) {
        console.log("[YOUTUBE] Skipping: missing player methods");
        return; // Không log warn quá thường xuyên để tránh spam console
      }

      // Gọi các phương thức một lần và cache kết quả
      const videoData = playerRef.current.getVideoData();
      if (!videoData || !videoData.video_id) {
        console.log("[YOUTUBE] Skipping: no video data");
        return;
      }

      const currentTime = playerRef.current.getCurrentTime();
      const duration = playerRef.current.getDuration();

      console.log(
        `[YOUTUBE] Current state: time=${currentTime}, duration=${duration}, isPaused=${videoState.isPaused}`
      );

      // Early return nếu dữ liệu không hợp lệ
      if (!currentTime || !duration || isNaN(currentTime) || isNaN(duration)) {
        console.log("[YOUTUBE] Skipping: invalid time/duration data");
        return;
      }

      // Early return nếu video đã kết thúc
      if (currentTime >= duration) {
        socket.emit("song_ended", {
          roomId,
          videoId: videoData.video_id,
        });
        return;
      }

      // Smart throttling cho YouTube player
      const timeDiff = Math.abs(currentTime - lastTimeRef.current.currentTime);
      const stateChanged =
        !videoState.isPaused !== lastTimeRef.current.isPlaying;

      // Giảm threshold để emit thường xuyên hơn
      const threshold = stateChanged ? 0.3 : 0.8; // Giảm từ 0.5/1.0 xuống 0.3/0.8

      // Force emit mỗi 3 giây để đảm bảo sync
      const timeSinceLastEmit =
        Date.now() - (lastTimeRef.current.lastEmitTime || 0);
      const shouldForceEmit = timeSinceLastEmit > 3000;

      if (timeDiff >= threshold || stateChanged || shouldForceEmit) {
        console.log(
          `[YOUTUBE] Emitting time_update: ${currentTime}/${duration}, playing: ${!videoState.isPaused}, reason: ${
            shouldForceEmit ? "force" : stateChanged ? "state" : "time"
          }`
        );

        socket.emit("time_update", {
          roomId,
          videoId: videoData.video_id,
          currentTime,
          duration,
          isPlaying: !videoState.isPaused,
        });

        // Cập nhật thời gian và trạng thái đã gửi
        lastTimeRef.current = {
          currentTime,
          isPlaying: !videoState.isPaused,
          lastEmitTime: Date.now(),
        };
      } else {
        console.log(
          `[YOUTUBE] Skipping emit: timeDiff=${timeDiff.toFixed(
            2
          )}, threshold=${threshold}, stateChanged=${stateChanged}, shouldForceEmit=${shouldForceEmit}`
        );
      }
    } catch (error) {
      // Chỉ log error trong dev mode để tránh spam console trong production
      if (process.env.NODE_ENV === "development") {
        console.error("Error accessing YouTube player methods:", error);
      }
    }
  }, [backupVideoRef, playerRef, handleBackupVideoEnd]);

  // Set up time update interval với adaptive timing để tránh lag
  useEffect(() => {
    const socket = socketRef.current;

    if (!socket) {
      console.log("[TIME_UPDATE] No socket, skipping interval setup");
      return;
    }
    // Bỏ check isPaused để luôn chạy interval

    console.log("[TIME_UPDATE] Setting up time update interval");

    // Sử dụng interval đơn giản và ổn định thay vì adaptive
    const intervalId = window.setInterval(() => {
      handleTimeUpdate();
    }, 1000); // Cố định 1 giây để ổn định

    return () => {
      console.log("[TIME_UPDATE] Clearing time update interval");
      clearInterval(intervalId);
    };
  }, [handleTimeUpdate]);

  // Thêm effect để reset adaptive timing khi có thay đổi quan trọng
  useEffect(() => {
    // Reset lastTimeRef khi video thay đổi để bắt đầu emit ngay lập tức
    console.log("[TIME_UPDATE] Video changed, resetting lastTimeRef");
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
      console.log("YouTube State Change:", event.data);

      try {
        // Video đang phát thì luôn tắt loading Jozo
        if (event.data === YT.PlayerState.PLAYING) {
          console.log("Video is now playing - hiding loading indicator");
          setIsChangingSong(false);
        }

        switch (event.data) {
          case YT.PlayerState.PLAYING:
            console.log("Video is now playing");

            // Cập nhật trạng thái và gửi event
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
            });
            break;

          case YT.PlayerState.BUFFERING:
            setVideoState((prev) => ({ ...prev, isBuffering: true }));
            break;

          case YT.PlayerState.PAUSED:
            console.log("Video is now paused");
            setVideoState((prev) => ({ ...prev, isPaused: true }));
            socket.emit("video_event", {
              roomId,
              event: "pause",
              videoId: playerRef.current.getVideoData().video_id,
              currentTime: playerRef.current.getCurrentTime(),
            });
            break;

          case YT.PlayerState.ENDED:
            handleVideoEnd();
            break;
        }
      } catch (error) {
        console.error("Error in handleStateChange:", error);
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
