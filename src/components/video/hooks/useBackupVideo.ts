import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BackupState, BackupVideoProps, VideoEvent } from "../types";
import React from "react";
import { devError, devLog } from "@/utils/devLog";
import {
  isHlsUrl,
  isLocalHlsFallbackEnabled,
  resolveHlsUrl,
} from "../../../utils/hls";

/**
 * Return type for useBackupVideo hook
 */
interface UseBackupVideoReturn {
  backupVideoRef: React.RefObject<HTMLVideoElement>;
  backupState: BackupState;
  setBackupState: React.Dispatch<React.SetStateAction<BackupState>>;
  handleYouTubeError: () => Promise<void>;
  handlePlaybackEvent: (event: VideoEvent) => void;
  handleVideoLoaded: () => void;
  handleVideoError: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
  onVideoEnd: () => void;
}

/**
 * Custom hook to handle backup video functionality when YouTube player fails
 */
export function useBackupVideo({
  videoId,
  roomId,
  volume,
  socket,
  onVideoReady,
  onVideoEnd,
  preserveBackupOnVideoChange = false,
  initialBackupUrl = "",
}: BackupVideoProps): UseBackupVideoReturn {
  const backupVideoRef = useRef<HTMLVideoElement>(null);
  const [backupState, setBackupState] = useState<BackupState>(() => ({
    backupUrl: initialBackupUrl,
    isLoadingBackup: false,
    backupError: false,
    backupVideoReady: false,
    youtubeError: !!initialBackupUrl,
  }));

  // Store latest props in refs
  const videoIdRef = useRef(videoId);
  const roomIdRef = useRef(roomId);
  const lastApiCallTimeRef = useRef<number>(0);
  const apiCallCountRef = useRef<number>(0);
  // Thêm một ref để theo dõi trạng thái hiện tại của backupState
  const backupStateRef = useRef(backupState);
  const videoReadyFiredForUrlRef = useRef("");

  // Cập nhật ref khi backupState thay đổi
  useEffect(() => {
    backupStateRef.current = backupState;
  }, [backupState]);

  // Update refs when values change
  useEffect(() => {
    videoIdRef.current = videoId;
    roomIdRef.current = roomId;
    devLog(`Updated refs - videoId: ${videoId}, roomId: ${roomId}`);
  }, [videoId, roomId]);

  // Handle YouTube errors by fetching backup video
  const handleYouTubeError = useCallback(async () => {
    devLog("===> INSIDE handleYouTubeError - HOOK FUNCTION <===");

    // Sử dụng backupStateRef thay vì backupState để luôn lấy giá trị mới nhất
    const currentBackupState = backupStateRef.current;

    // Nếu đã có backupUrl, bỏ qua hoàn toàn (tránh gọi trùng).
    if (currentBackupState.backupUrl) {
      devLog("[SKIP] Already using backup URL, no API call needed");
      return;
    }

    // Rate limit 5s để tránh spam API khi retry dồn dập.
    // Nếu bị chặn, phải RESET state kẹt (isLoadingBackup / youtubeError) để
    // UI không treo loading — nhiều nơi upstream pre-set các cờ này trước
    // khi gọi handleYouTubeError.
    const now = Date.now();
    const secondsSinceLastCall = (now - lastApiCallTimeRef.current) / 1000;
    if (secondsSinceLastCall < 5) {
      devLog(
        `[RATE LIMIT] Attempted to call API too frequently (${secondsSinceLastCall.toFixed(
          1,
        )}s since last call)`,
      );
      setBackupState((prev) =>
        prev.isLoadingBackup ? { ...prev, isLoadingBackup: false } : prev,
      );
      return;
    }

    // Sử dụng giá trị mới nhất từ ref
    const currentVideoId = videoIdRef.current;
    const currentRoomId = roomIdRef.current;

    // Đảm bảo có videoId và roomId
    if (!currentVideoId || !currentRoomId) {
      devError(
        `Missing params: videoId=${currentVideoId}, roomId=${currentRoomId}`,
      );
      // Reset state kẹt để không treo loading vĩnh viễn.
      setBackupState((prev) =>
        prev.isLoadingBackup || prev.youtubeError
          ? { ...prev, isLoadingBackup: false, youtubeError: false }
          : prev,
      );
      return;
    }

    // Cập nhật timestamp và counter
    lastApiCallTimeRef.current = now;
    apiCallCountRef.current += 1;

    devLog(
      `===> Getting backup for video ID [${currentVideoId}] in room [${currentRoomId}] (call #${apiCallCountRef.current}) <===`,
    );

    try {
      // Bắt đầu tải ngay, không cần kiểm tra trạng thái trước đó
      setBackupState((prev) => ({
        ...prev,
        isLoadingBackup: true,
        backupError: false,
        youtubeError: true,
      }));

      // Local worker discovery is opt-in for development only. Production relies
      // exclusively on hls_url hydrated from the BE catalog.
      if (isLocalHlsFallbackEnabled()) {
        const hlsUrl = await resolveHlsUrl(currentVideoId);
        if (hlsUrl) {
          console.log(
            "===> Using explicit local HLS fallback URL:",
            hlsUrl,
            " <===",
          );
          setBackupState((prev) => ({
            ...prev,
            backupUrl: hlsUrl,
            isLoadingBackup: false,
            youtubeError: true,
          }));
          return;
        }
      }

      // Xóa timeout cũ nếu có
      const timeout = 20000; // Tăng timeout để đủ thời gian cho API phản hồi
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        devLog("Backup API request timed out");
        controller.abort();
      }, timeout);

      // Kiểm tra biến môi trường
      const baseUrl =
        import.meta.env.VITE_API_BASE_URL ||
        (import.meta.env.DEV ? "http://localhost:4000" : "");
      if (!baseUrl) {
        devError(
          "===> ERROR: VITE_API_BASE_URL is not defined in environment variables <===",
        );
        throw new Error("API base URL not defined");
      }
      devLog("===> API Base URL:", baseUrl, " <===");

      // Kiểm tra một lần nữa để chắc chắn
      if (!currentVideoId || !currentRoomId) {
        throw new Error(
          `Invalid parameters for API call: videoId=${currentVideoId}, roomId=${currentRoomId}`,
        );
      }

      // Tạo URL với room ID và video ID
      const backupApiUrl = `${baseUrl}/room-music/${currentRoomId}/${currentVideoId}`;
      devLog("===> Calling backup API:", backupApiUrl, " <===");

      // Thêm query param để bỏ qua cache và debug
      const noCache = Date.now();
      devLog("===> Starting axios request <===");

      // Tạo request với timeout dài hơn
      const response = await axios.get(
        `${backupApiUrl}?_=${noCache}&debug=true`,
        {
          signal: controller.signal,
          timeout: timeout,
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        },
      );
      devLog("===> Axios request completed <===");

      clearTimeout(timeoutId);

      if (response.data?.result?.url) {
        devLog("API returned backup URL successfully");
        setBackupState((prev) => ({
          ...prev,
          backupUrl: response.data.result.url,
          isLoadingBackup: false,
          youtubeError: true,
        }));
      } else {
        devError("No backup URL in response:", response.data);
        throw new Error("No backup URL in API response");
      }
    } catch (error) {
      devError("Error getting backup:", error);
      // Đặt trạng thái lỗi nhưng không hiển thị cho người dùng
      setBackupState((prev) => ({
        ...prev,
        isLoadingBackup: false,
      }));

      // Thử lại sau 2 giây nếu thất bại
      setTimeout(() => {
        // Sử dụng ref thay vì giá trị tại thời điểm closure được tạo
        const currentState = backupStateRef.current;
        // Chỉ thử lại nếu vẫn trong trạng thái lỗi và chưa có backup URL
        if (!currentState.backupUrl && currentState.youtubeError) {
          devLog("Retrying backup API call...");
          handleYouTubeError();
        }
      }, 2000);
    }
  }, []);

  // Update volume for backup video
  useEffect(() => {
    if (backupVideoRef.current) {
      backupVideoRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Probe the local worker whenever the song changes. YouTube remains the
  // normal primary player when the worker has no ready HLS copy.
  useEffect(() => {
    if (!videoId || preserveBackupOnVideoChange) return;

    videoReadyFiredForUrlRef.current = "";
    setBackupState({
      backupUrl: "",
      isLoadingBackup: true,
      backupError: false,
      backupVideoReady: false,
      youtubeError: true,
    });

    let cancelled = false;
    void resolveHlsUrl(videoId).then((hlsUrl) => {
      if (cancelled) return;

      if (hlsUrl) {
        setBackupState((prev) => ({
          ...prev,
          backupUrl: hlsUrl,
          isLoadingBackup: false,
          youtubeError: true,
        }));
        return;
      }

      // No local copy (or local worker unavailable): use YouTube normally.
      setBackupState((prev) => ({
        ...prev,
        backupUrl: "",
        isLoadingBackup: false,
        youtubeError: false,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [videoId, preserveBackupOnVideoChange]);

  // Handle playback events for backup video
  const handlePlaybackEvent = useCallback(
    (event: VideoEvent) => {
      if (!backupVideoRef.current || !backupState.backupUrl) return;

      switch (event.event) {
        case "play":
          backupVideoRef.current.currentTime = event.currentTime;
          backupVideoRef.current
            .play()
            .catch((e) => devError("Error playing backup video:", e));
          break;
        case "pause":
          backupVideoRef.current.pause();
          break;
        case "seek":
          backupVideoRef.current.currentTime = event.currentTime;
          break;
      }
    },
    [backupState.backupUrl],
  );

  // Handler for when backup video is loaded
  const handleVideoLoaded = useCallback(() => {
    devLog("Backup video ready");

    const currentVideoId = videoIdRef.current;
    const currentRoomId = roomIdRef.current;
    setBackupState((prev) => ({
      ...prev,
      backupVideoReady: true,
      isLoadingBackup: false,
    }));

    if (backupVideoRef.current) {
      try {
        backupVideoRef.current.volume = volume / 100;
        backupVideoRef.current.muted = false;

        devLog(
          "Backup video audio settings: volume =",
          volume / 100,
          "muted =",
          false,
        );
      } catch (e) {
        devError("Error setting backup audio:", e);
      }
    }

    if (currentRoomId && currentVideoId) {
      socket?.emit("video_ready", {
        roomId: currentRoomId,
        videoId: currentVideoId,
      });
    }

    setTimeout(() => {
      onVideoReady();

      // Auto play backup video and hide YouTube player
      if (backupVideoRef.current) {
        devLog(
          "Starting playback of backup video with delay to prevent conflicts",
        );

        // Đảm bảo volume được thiết lập trước khi phát
        backupVideoRef.current.volume = volume / 100;

        // Đảm bảo video không bị tắt tiếng
        backupVideoRef.current.muted = false;

        backupVideoRef.current
          .play()
          .then(() => {
            devLog("Backup video playing successfully");
          })
          .catch((error) => {
            devError("Error auto-playing backup video:", error);
            // Thử phát lần nữa sau khi người dùng tương tác
            document.addEventListener(
              "click",
              () => {
                if (backupVideoRef.current) {
                  backupVideoRef.current.volume = volume / 100;
                  backupVideoRef.current.muted = false;
                  backupVideoRef.current
                    .play()
                    .catch((e) =>
                      devError(
                        "Still couldn't play after user interaction:",
                        e,
                      ),
                    );
                }
              },
              { once: true },
            );
          });
      }
    }, 100); // Giảm delay xuống 100ms để bắt đầu phát nhanh hơn
  }, [socket, onVideoReady, volume]);

  // Handler for backup video error
  const handleVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      devError("Error playing backup video:", e);

      const currentUrl = backupStateRef.current.backupUrl;
      // Local HLS failed: fall back to the already-mounted YouTube iframe.
      if (isHlsUrl(currentUrl)) {
        videoReadyFiredForUrlRef.current = "";
        setBackupState((prev) => ({
          ...prev,
          backupUrl: "",
          backupVideoReady: false,
          isLoadingBackup: false,
          youtubeError: false,
          backupError: true,
        }));
        return;
      }

      videoReadyFiredForUrlRef.current = "";
      setBackupState((prev) => ({
        ...prev,
        backupUrl: "",
        backupVideoReady: false,
        isLoadingBackup: false,
      }));
    },
    [],
  );

  return {
    backupVideoRef,
    backupState,
    setBackupState,
    handleYouTubeError,
    handlePlaybackEvent,
    handleVideoLoaded,
    handleVideoError,
    onVideoEnd,
  };
}
