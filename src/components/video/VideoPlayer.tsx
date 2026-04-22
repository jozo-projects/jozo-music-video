/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { logo } from "../../assets";
import { RecordingStudio } from "../../RecordingStudio";
import { CUTE_MESSAGES, FALLBACK_VIDEO_ID } from "./constants";
import { useBackupVideo } from "./hooks/useBackupVideo";
import { useSocketConnection } from "./hooks/useSocketConnection";
import { useVideoEvents } from "./hooks/useVideoEvents";
import PauseOverlay from "./PauseOverlay";
import {
  BackupState,
  VideoState,
  VolumeToast,
  YouTubePlayerRef,
} from "./types";
import {
  ConnectionStatusIndicator,
  NetworkStatusIndicator,
  PoweredByBadge,
  VolumeToastComponent,
} from "./UIOverlays";
import WelcomeScreen from "./WelcomeScreen";
import YouTubePlayerIframe from "./YouTubePlayerIframe";
import { enforceFallbackQualityOnChange } from "./youtubePlaybackQuality";

const IS_DEV = import.meta.env.DEV;
const devLog = (...args: unknown[]) => {
  if (IS_DEV) console.log(...args);
};
const devError = (...args: unknown[]) => {
  if (IS_DEV) console.error(...args);
};

interface YouTubePlayerEvent {
  data: number;
  target: {
    setPlaybackQuality: (quality: string) => void;
    playVideo: () => void;
    seekTo: (time: number, allowSeekAhead: boolean) => void;
    mute: () => void;
    setVolume: (volume: number) => void;
    getVideoData: () => { video_id: string };
    getCurrentTime: () => number;
    getDuration: () => number;
    pauseVideo?: () => void;
    unMute?: () => void;
    isMuted?: () => boolean;
    getVolume?: () => number;
    getPlayerState?: () => number;
    getAvailableQualityLevels?: () => string[];
  };
}

interface YouTubeQualityEvent {
  data: string;
  target: {
    setPlaybackQuality: (quality: string) => void;
  };
}

// Memo component con để parent re-render không kéo re-render iframe.
const MemoYouTubePlayerIframe = memo(YouTubePlayerIframe);

const VideoPlayer = () => {
  const playerRef = useRef<YouTubePlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const roomId = params.get("roomId") || "";

  const [videoState, setVideoState] = useState<VideoState>({
    nowPlayingData: null,
    currentVideoId: "",
    isPaused: true,
    isBuffering: false,
  });

  const [isChangingSong, setIsChangingSong] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [volume, setVolume] = useState(100);
  const [showTitle, setShowTitle] = useState(true);
  const [volumeToast, setVolumeToast] = useState<VolumeToast>({
    show: false,
    value: 100,
  });
  const [showPoweredBy, setShowPoweredBy] = useState(true);

  const { socket, socketStatus, isVideoOff } = useSocketConnection({
    roomId,
    onConnect: () => {
      socket?.emit("request_current_song", { roomId });
    },
    onVideosOff: () => {},
    onVideosOn: () => {},
  });

  // ID bài hát hiện tại (giữ qua những khoảng transition để không nháy UI).
  const currentVideoRef = useRef<string | null>(null);

  useEffect(() => {
    if (videoState.nowPlayingData?.video_id) {
      currentVideoRef.current = videoState.nowPlayingData.video_id;
    }
  }, [videoState.nowPlayingData?.video_id]);

  // ID thực tế để render iframe. Nếu không có → KHÔNG mount iframe
  // (chỉ mount player khi thực sự có bài đang phát).
  const activeVideoId =
    videoState.nowPlayingData?.video_id || currentVideoRef.current || "";

  const handleBackupVideoEnd = useCallback(() => {
    if (!socket || !videoState.nowPlayingData) return;

    if (backupVideoRef.current) {
      const currentTime = backupVideoRef.current.currentTime;
      const duration = backupVideoRef.current.duration;

      if (duration && currentTime >= duration - 1.5) {
        socket.emit("song_ended", {
          roomId,
          videoId: videoState.nowPlayingData.video_id,
        });
      }
    }
    // backupVideoRef được destructure sau, nhưng forward-reference OK
    // vì callback chỉ được gọi sau khi useBackupVideo đã chạy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, videoState.nowPlayingData, roomId]);

  const {
    backupVideoRef,
    backupState,
    setBackupState,
    handleYouTubeError: fetchBackupVideo,
    handleVideoLoaded: onBackupVideoLoaded,
    handleVideoError,
    onVideoEnd,
  } = useBackupVideo({
    videoId: activeVideoId,
    roomId,
    volume,
    socket,
    onVideoReady: () => {
      if (playerRef.current) {
        try {
          playerRef.current.mute?.();
        } catch (e) {
          devError("Error muting YouTube player:", e);
        }
      }

      setVideoState((prev) => ({ ...prev, isPaused: false }));

      if (socket && backupVideoRef.current) {
        socket.emit("video_event", {
          roomId,
          event: "play",
          videoId: activeVideoId,
          currentTime: backupVideoRef.current.currentTime || 0,
          seconds: backupVideoRef.current.currentTime || 0,
        });
      }
    },
    onVideoEnd: handleBackupVideoEnd,
  });

  const { handleVideoEnd } = useVideoEvents({
    socket,
    roomId,
    videoState,
    setVideoState,
    setIsChangingSong,
    playerRef,
    backupVideoRef,
    handleBackupVideoEnd,
    backupState,
    setBackupState,
  });

  const handleStateChange = useCallback(
    (event: YouTubePlayerEvent) => {
      if (!playerRef.current || !socket) return;

      const YT = (window as any).YT?.PlayerState;
      if (!YT) return;

      switch (event.data) {
        case YT.BUFFERING:
          if (videoState.nowPlayingData && !isChangingSong) {
            setVideoState((prev) => ({ ...prev, isBuffering: true }));
          }
          break;
        case YT.PLAYING: {
          setIsChangingSong(false);
          setVideoState((prev) => ({
            ...prev,
            isBuffering: false,
            isPaused: false,
          }));

          try {
            if (playerRef.current.isMuted?.()) {
              playerRef.current.unMute?.();
              playerRef.current.setVolume?.(volume);
            }
          } catch {
            // ignore
          }

          try {
            const currentTime = playerRef.current.getCurrentTime();
            const videoId = playerRef.current.getVideoData().video_id;
            socket.emit("video_event", {
              roomId,
              event: "play",
              videoId,
              currentTime,
              seconds: currentTime,
            });
          } catch {
            // ignore
          }
          break;
        }
        case YT.PAUSED: {
          setVideoState((prev) => ({ ...prev, isPaused: true }));
          try {
            const t = playerRef.current.getCurrentTime();
            const vid = playerRef.current.getVideoData().video_id;
            socket.emit("video_event", {
              roomId,
              event: "pause",
              videoId: vid,
              currentTime: t,
              seconds: t,
            });
          } catch {
            // ignore
          }
          break;
        }
        case YT.ENDED:
          handleVideoEnd();
          break;
      }
    },
    [
      socket,
      roomId,
      handleVideoEnd,
      volume,
      videoState.nowPlayingData,
      isChangingSong,
    ]
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % CUTE_MESSAGES.length);
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // Show/hide song title: visible 10s đầu mỗi bài mới; khi pause luôn hiện.
  useEffect(() => {
    if (
      !videoState.nowPlayingData ||
      videoState.nowPlayingData.video_id === FALLBACK_VIDEO_ID
    ) {
      return;
    }
    if (videoState.isPaused) {
      setShowTitle(true);
      return;
    }
    setShowTitle(true);
    const timer = setTimeout(() => setShowTitle(false), 10000);
    return () => clearTimeout(timer);
  }, [videoState.nowPlayingData, videoState.isPaused]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Force hide loading indicator sau 5s (safety net duy nhất).
  useEffect(() => {
    if (!isChangingSong) return;
    const timeout = setTimeout(() => setIsChangingSong(false), 5000);
    return () => clearTimeout(timeout);
  }, [isChangingSong]);

  // Ẩn loading khi đã hết buffer và có bài hợp lệ.
  useEffect(() => {
    if (
      !videoState.isBuffering &&
      isChangingSong &&
      videoState.nowPlayingData &&
      videoState.nowPlayingData.video_id !== FALLBACK_VIDEO_ID
    ) {
      setIsChangingSong(false);
    }
  }, [
    videoState.isBuffering,
    isChangingSong,
    videoState.nowPlayingData,
  ]);

  useEffect(() => {
    if (!socket) return;

    const handleVolumeChange = (newVolume: number) => {
      setVolume(newVolume);
      setVolumeToast({ show: true, value: newVolume });

      if (playerRef.current?.setVolume) {
        playerRef.current.setVolume(newVolume);
      }
      if (backupVideoRef.current) {
        backupVideoRef.current.volume = newVolume / 100;
      }

      const hideToastTimeout = setTimeout(() => {
        setVolumeToast((prev) => ({ ...prev, show: false }));
      }, 2000);

      return () => clearTimeout(hideToastTimeout);
    };

    socket.on("volumeChange", handleVolumeChange);

    return () => {
      socket.off("volumeChange", handleVolumeChange);
    };
  }, [socket, backupVideoRef]);

  useEffect(() => {
    if (backupVideoRef.current) {
      backupVideoRef.current.volume = volume / 100;
    }
  }, [volume, backupVideoRef]);

  // Hiển thị "Powered by Jozo" đầu bài 6s.
  useEffect(() => {
    if (
      videoState.nowPlayingData &&
      videoState.nowPlayingData.video_id !== FALLBACK_VIDEO_ID
    ) {
      setShowPoweredBy(true);
      const hideTimer = setTimeout(() => setShowPoweredBy(false), 6000);
      return () => clearTimeout(hideTimer);
    }
    // Chủ ý chỉ phụ thuộc video_id — chỉ chạy khi đổi bài.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoState.nowPlayingData?.video_id]);

  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (containerRef.current) {
          containerRef.current.requestFullscreen();
        }
      } catch {
        // ignore fullscreen errors
      }
    }
    lastTapRef.current = now;
  }, []);

  // Khi player ready lần đầu: sync time với server + set volume.
  const handleYouTubePlayerReady = useCallback(
    (event: YouTubePlayerEvent) => {
      try {
        event.target.unMute?.();
        event.target.setVolume(volume);
      } catch {
        // ignore
      }

      try {
        if (videoState.nowPlayingData) {
          const serverTimestamp = videoState.nowPlayingData.timestamp;
          const serverCurrentTime = videoState.nowPlayingData.currentTime;
          const now = Date.now();
          const elapsed = (now - serverTimestamp) / 1000;
          const targetTime = Math.max(0, serverCurrentTime + elapsed);
          event.target.seekTo(targetTime, true);
        }
        event.target.playVideo();
        setIsChangingSong(false);
      } catch (e) {
        devError("Error playing video on ready:", e);
      }

      socket?.emit("video_ready", {
        roomId,
        videoId:
          videoState.nowPlayingData?.video_id || currentVideoRef.current,
      });

      setVideoState((prev) => ({ ...prev, isPaused: false }));
    },
    [volume, socket, roomId, videoState.nowPlayingData]
  );

  const handlePlaybackQualityChange = useCallback(
    (event: YouTubeQualityEvent) => {
      const isFallback = videoState.currentVideoId === FALLBACK_VIDEO_ID;
      enforceFallbackQualityOnChange(isFallback, event.data, event.target);
    },
    [videoState.currentVideoId]
  );

  const triggerBackupVideo = useCallback(() => {
    if (
      backupState.youtubeError ||
      backupState.isLoadingBackup ||
      backupState.backupUrl
    ) {
      return;
    }
    if (!activeVideoId || !roomId) return;

    setBackupState((prev: BackupState) => ({
      ...prev,
      youtubeError: true,
      isLoadingBackup: true,
    }));

    fetchBackupVideo().catch((err) => devError("Error fetching backup:", err));
  }, [
    activeVideoId,
    roomId,
    fetchBackupVideo,
    setBackupState,
    backupState.youtubeError,
    backupState.isLoadingBackup,
    backupState.backupUrl,
  ]);

  // Check iframe stuck sau 8s — nếu player chưa start phát thì chuyển backup.
  useEffect(() => {
    if (
      !videoState.nowPlayingData?.video_id ||
      backupState.backupUrl ||
      backupState.isLoadingBackup ||
      backupState.youtubeError
    ) {
      return;
    }

    const checkTimeout = setTimeout(() => {
      if (!playerRef.current?.getPlayerState) return;
      try {
        const state = playerRef.current.getPlayerState();
        const currentTime = playerRef.current.getCurrentTime?.() || 0;
        if (state === -1 && currentTime < 0.5) {
          triggerBackupVideo();
        }
      } catch {
        // ignore
      }
    }, 8000);

    return () => clearTimeout(checkTimeout);
  }, [
    videoState.nowPlayingData?.video_id,
    backupState.youtubeError,
    backupState.backupUrl,
    backupState.isLoadingBackup,
    triggerBackupVideo,
  ]);

  const handleYouTubeError = useCallback(
    (event: YouTubePlayerEvent) => {
      setIsChangingSong(false);
      if (
        backupState.backupUrl ||
        backupState.isLoadingBackup ||
        backupState.youtubeError
      ) {
        return;
      }
      triggerBackupVideo();
      socket?.emit("video_error", {
        roomId,
        videoId: activeVideoId,
        errorCode: event.data,
        message: "YouTube error, switching to backup source",
      });
    },
    [
      roomId,
      activeVideoId,
      socket,
      triggerBackupVideo,
      backupState.backupUrl,
      backupState.isLoadingBackup,
      backupState.youtubeError,
    ]
  );

  // Khi backup video ready → tắt tiếng + pause YouTube player (giữ nguyên iframe).
  useEffect(() => {
    if (!(backupState.backupUrl && backupState.backupVideoReady)) return;
    const player = playerRef.current;
    if (!player) return;
    try {
      player.mute?.();
      player.pauseVideo?.();
    } catch {
      // ignore
    }
  }, [backupState.backupUrl, backupState.backupVideoReady]);

  const handlePlaySong = useCallback((data: any) => {
    if (data?.video_id) {
      currentVideoRef.current = data.video_id;
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on("play_song", handlePlaySong);
    socket.on("current_song", handlePlaySong);
    return () => {
      socket.off("play_song", handlePlaySong);
      socket.off("current_song", handlePlaySong);
    };
  }, [socket, handlePlaySong]);

  // Reset trạng thái lỗi YouTube sau 30s nếu backup không load được → cho phép thử lại.
  useEffect(() => {
    if (
      !backupState.youtubeError ||
      backupState.backupUrl ||
      backupState.isLoadingBackup
    ) {
      return;
    }
    const resetTimeout = setTimeout(() => {
      setBackupState((prev) => ({
        ...prev,
        youtubeError: false,
        backupError: false,
      }));
      if (
        videoState.nowPlayingData?.video_id &&
        roomId &&
        socket?.connected
      ) {
        socket.emit("request_current_song", { roomId });
      }
    }, 30000);
    return () => clearTimeout(resetTimeout);
  }, [
    backupState.youtubeError,
    backupState.backupUrl,
    backupState.isLoadingBackup,
    videoState.nowPlayingData?.video_id,
    roomId,
    socket,
    setBackupState,
  ]);

  if (isVideoOff) {
    return <RecordingStudio />;
  }

  const isBackupActive = !!(
    backupState.backupUrl && backupState.backupVideoReady
  );
  const hidePrimaryIframe = backupState.youtubeError || isBackupActive;
  const hasActiveSong =
    !!activeVideoId && activeVideoId !== FALLBACK_VIDEO_ID;

  const initialStartSeconds = videoState.nowPlayingData
    ? Math.max(
        0,
        videoState.nowPlayingData.currentTime +
          (Date.now() - videoState.nowPlayingData.timestamp) / 1000
      )
    : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen"
      onClick={handleDoubleTap}
    >
      {/* CSS tối thiểu: ẩn mọi overlay của YouTube (UI, endscreen, error…).
          KHÔNG có fade-in/video-transition/backdrop-blur. */}
      <style>
        {`
          .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top,
          .ytp-gradient-bottom, .ytp-pause-overlay, .ytp-share-button,
          .ytp-watch-later-button, .ytp-watermark, .ytp-youtube-button,
          .ytp-progress-bar-container, .ytp-time-display, .ytp-volume-panel,
          .ytp-menuitem, .ytp-spinner, .ytp-contextmenu, .ytp-ce-element,
          .ytp-ce-covering-overlay, .ytp-ce-element-shadow,
          .ytp-ce-covering-image, .ytp-ce-expanding-image,
          .ytp-ce-rendered-image, .ytp-endscreen-content,
          .ytp-suggested-video-overlay, .ytp-pause-overlay-container,
          .ytp-endscreen-previous, .ytp-endscreen-next, .ytp-player-content,
          .html5-endscreen, .ytp-show-tiles .ytp-videowall-still,
          .ytp-error, .ytp-error-content-wrap,
          .ytp-error-content-wrap-reason, .ytp-error-content {
            display: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          .html5-video-player.ytp-error-content-visible .html5-video-container {
            display: none !important;
          }
        `}
      </style>

      <NetworkStatusIndicator isOnline={isOnline} />
      <ConnectionStatusIndicator
        connected={socketStatus.connected}
        connectionAttempts={socketStatus.connectionAttempts}
      />

      {(backupState.isLoadingBackup || isChangingSong) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50">
          <div className="rounded-full h-16 w-16 border-t-4 border-white mx-auto mb-4">
            <img src={logo} alt="logo" className="w-full h-full" />
          </div>
          <p className="text-white">Đang tải video...</p>
        </div>
      )}

      {/* Backup video */}
      {backupState.backupUrl && (
        <div
          className={`absolute inset-0 w-full h-full z-10 ${
            isBackupActive ? "opacity-100" : "opacity-0"
          }`}
        >
          <video
            ref={backupVideoRef}
            key={backupState.backupUrl}
            className="absolute inset-0 w-full h-full object-contain"
            autoPlay
            playsInline
            controls={false}
            disablePictureInPicture
            controlsList="nodownload noplaybackrate nofullscreen"
            onLoadedData={onBackupVideoLoaded}
            onEnded={onVideoEnd}
            onError={handleVideoError}
            preload="auto"
            muted={volume === 0}
            style={{
              objectFit: "contain",
              width: "100%",
              height: "100%",
              backgroundColor: "#000",
            }}
          >
            <source src={backupState.backupUrl} type="video/mp4" />
            <source src={backupState.backupUrl} type="video/webm" />
            <source src={backupState.backupUrl} type="video/ogg" />
          </video>
        </div>
      )}

      {/* YouTube iframe — CHỈ mount khi có bài đang phát. */}
      {hasActiveSong && (
        <div
          className={`absolute top-0 left-0 w-full h-full z-[5] ${
            hidePrimaryIframe ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <MemoYouTubePlayerIframe
            playerRef={playerRef}
            videoId={activeVideoId}
            startSeconds={initialStartSeconds}
            onReady={handleYouTubePlayerReady}
            onStateChange={handleStateChange}
            onError={handleYouTubeError}
            onPlaybackQualityChange={handlePlaybackQualityChange}
          />
        </div>
      )}

      {backupState.youtubeError && !backupState.backupVideoReady && (
        <div className="absolute inset-0 bg-black z-40" />
      )}

      <div className="absolute z-30 top-[15px] right-[15px] w-[140px] h-[50px] bg-black">
        <img src={logo} alt="logo" className="w-full h-full" />
      </div>

      {/* Pause overlay — bg đen mờ thuần, KHÔNG dùng backdrop-blur. */}
      {videoState.isPaused && hasActiveSong && (
        <>
          <div className="absolute inset-0 z-[25] bg-black/50" />
          <PauseOverlay nowPlayingData={videoState.nowPlayingData!} />
        </>
      )}

      {/* Welcome screen khi không có bài. */}
      {!hasActiveSong && <WelcomeScreen currentMessageIndex={currentMessageIndex} />}

      {videoState.nowPlayingData && showTitle && hasActiveSong && (
        <div className="absolute top-4 left-4 z-50 bg-black p-4 rounded-lg text-white">
          <p className="font-bold">{videoState.nowPlayingData.title}</p>
          <p className="text-sm">Jozo</p>
        </div>
      )}

      <VolumeToastComponent volumeToast={volumeToast} />

      <PoweredByBadge show={showPoweredBy || !hasActiveSong} />

      {backupState.youtubeError &&
        !backupState.backupVideoReady &&
        !backupState.isLoadingBackup &&
        backupState.backupError &&
        !IS_DEV && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50">
            <div className="rounded-full h-16 w-16 border-t-4 border-white">
              <img src={logo} alt="logo" className="w-full h-full" />
            </div>
            <p className="text-white mt-5 text-center max-w-md">
              Video không khả dụng! Vui lòng thử lại sau.
            </p>
          </div>
        )}

      {backupState.youtubeError &&
        !backupState.backupVideoReady &&
        backupState.isLoadingBackup &&
        !IS_DEV && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50">
            <div className="rounded-full h-16 w-16 border-t-4 border-white">
              <img src={logo} alt="logo" className="w-full h-full" />
            </div>
            <p className="text-white mt-5 text-center max-w-md">
              Đang tải video...
            </p>
          </div>
        )}
    </div>
  );
};

export default memo(VideoPlayer);

// Dùng devLog tạm để tránh lint unused-var khi IS_DEV=false.
void devLog;
