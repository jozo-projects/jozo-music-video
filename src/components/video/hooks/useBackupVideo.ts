import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BackupState, BackupVideoProps, VideoEvent } from "../types";
import React from "react";

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
}: BackupVideoProps): UseBackupVideoReturn {
  const backupVideoRef = useRef<HTMLVideoElement>(null);
  const [backupState, setBackupState] = useState<BackupState>({
    backupUrl: "",
    isLoadingBackup: false,
    backupError: false,
    backupVideoReady: false,
    youtubeError: false,
  });

  // Store latest props in refs
  const videoIdRef = useRef(videoId);
  const roomIdRef = useRef(roomId);
  const lastApiCallTimeRef = useRef<number>(0);
  const apiCallCountRef = useRef<number>(0);
  // Thêm một ref để theo dõi trạng thái hiện tại của backupState
  const backupStateRef = useRef(backupState);

  // Cập nhật ref khi backupState thay đổi
  useEffect(() => {
    backupStateRef.current = backupState;
  }, [backupState]);

  // Update refs when values change
  useEffect(() => {
    videoIdRef.current = videoId;
    roomIdRef.current = roomId;
    console.log(`Updated refs - videoId: ${videoId}, roomId: ${roomId}`);
  }, [videoId, roomId]);

  // Handle YouTube errors by fetching backup video
  const handleYouTubeError = useCallback(async () => {
    console.log("===> INSIDE handleYouTubeError - HOOK FUNCTION <===");

    // Sử dụng backupStateRef thay vì backupState để luôn lấy giá trị mới nhất
    const currentBackupState = backupStateRef.current;

    // Nếu đã có backupUrl, bỏ qua hoàn toàn (tránh gọi trùng).
    if (currentBackupState.backupUrl) {
      console.log("[SKIP] Already using backup URL, no API call needed");
      return;
    }

    // Rate limit 5s để tránh spam API khi retry dồn dập.
    // Nếu bị chặn, phải RESET state kẹt (isLoadingBackup / youtubeError) để
    // UI không treo loading — nhiều nơi upstream pre-set các cờ này trước
    // khi gọi handleYouTubeError.
    const now = Date.now();
    const secondsSinceLastCall = (now - lastApiCallTimeRef.current) / 1000;
    if (secondsSinceLastCall < 5) {
      console.log(
        `[RATE LIMIT] Attempted to call API too frequently (${secondsSinceLastCall.toFixed(
          1
        )}s since last call)`
      );
      setBackupState((prev) =>
        prev.isLoadingBackup
          ? { ...prev, isLoadingBackup: false }
          : prev
      );
      return;
    }

    // Sử dụng giá trị mới nhất từ ref
    const currentVideoId = videoIdRef.current;
    const currentRoomId = roomIdRef.current;

    // Đảm bảo có videoId và roomId
    if (!currentVideoId || !currentRoomId) {
      console.error(
        `Missing params: videoId=${currentVideoId}, roomId=${currentRoomId}`
      );
      // Reset state kẹt để không treo loading vĩnh viễn.
      setBackupState((prev) =>
        prev.isLoadingBackup || prev.youtubeError
          ? { ...prev, isLoadingBackup: false, youtubeError: false }
          : prev
      );
      return;
    }

    // Cập nhật timestamp và counter
    lastApiCallTimeRef.current = now;
    apiCallCountRef.current += 1;

    console.log(
      `===> Getting backup for video ID [${currentVideoId}] in room [${currentRoomId}] (call #${apiCallCountRef.current}) <===`
    );

    try {
      // Bắt đầu tải ngay, không cần kiểm tra trạng thái trước đó
      setBackupState((prev) => ({
        ...prev,
        isLoadingBackup: true,
        backupError: false,
        youtubeError: true,
      }));

      // Xóa timeout cũ nếu có
      const timeout = 20000; // Tăng timeout để đủ thời gian cho API phản hồi
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log("Backup API request timed out");
        controller.abort();
      }, timeout);

      // Kiểm tra biến môi trường
      const baseUrl = import.meta.env.VITE_API_BASE_URL;
      if (!baseUrl) {
        console.error(
          "===> ERROR: VITE_API_BASE_URL is not defined in environment variables <==="
        );
        throw new Error("API base URL not defined");
      }
      console.log("===> API Base URL:", baseUrl, " <===");

      // Kiểm tra một lần nữa để chắc chắn
      if (!currentVideoId || !currentRoomId) {
        throw new Error(
          `Invalid parameters for API call: videoId=${currentVideoId}, roomId=${currentRoomId}`
        );
      }

      // Tạo URL với room ID và video ID
      const backupApiUrl = `${baseUrl}/room-music/${currentRoomId}/${currentVideoId}`;
      console.log("===> Calling backup API:", backupApiUrl, " <===");

      // Thêm query param để bỏ qua cache và debug
      const noCache = Date.now();
      console.log("===> Starting axios request <===");

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
        }
      );
      console.log("===> Axios request completed <===");

      clearTimeout(timeoutId);

      if (response.data?.result?.url) {
        console.log("API returned backup URL successfully");
        setBackupState((prev) => ({
          ...prev,
          backupUrl: response.data.result.url,
          isLoadingBackup: false,
          youtubeError: true,
        }));
      } else {
        console.error("No backup URL in response:", response.data);
        throw new Error("No backup URL in API response");
      }
    } catch (error) {
      console.error("Error getting backup:", error);
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
          console.log("Retrying backup API call...");
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

  // Reset state when videoId changes
  useEffect(() => {
    if (videoId) {
      setBackupState({
        backupUrl: "",
        isLoadingBackup: false,
        backupError: false,
        backupVideoReady: false,
        youtubeError: false,
      });
    }
  }, [videoId]);

  // Handle playback events for backup video
  const handlePlaybackEvent = useCallback(
    (event: VideoEvent) => {
      if (!backupVideoRef.current || !backupState.backupUrl) return;

      switch (event.event) {
        case "play":
          backupVideoRef.current.currentTime = event.currentTime;
          backupVideoRef.current
            .play()
            .catch((e) => console.error("Error playing backup video:", e));
          break;
        case "pause":
          backupVideoRef.current.pause();
          break;
        case "seek":
          backupVideoRef.current.currentTime = event.currentTime;
          break;
      }
    },
    [backupState.backupUrl]
  );

  // Handler for when backup video is loaded
  const handleVideoLoaded = useCallback(() => {
    console.log("Backup video ready");

    // Lấy giá trị videoId và roomId mới nhất
    const currentVideoId = videoIdRef.current;
    const currentRoomId = roomIdRef.current;

    setBackupState((prev) => ({
      ...prev,
      backupVideoReady: true,
      isLoadingBackup: false,
    }));

    // Chỉ tắt tiếng YouTube khi backup video đã thực sự sẵn sàng
    if (backupVideoRef.current) {
      try {
        // Đảm bảo backup video có âm thanh trước khi tắt tiếng YouTube player
        backupVideoRef.current.volume = volume / 100;
        backupVideoRef.current.muted = false;

        console.log(
          "Backup video audio settings: volume =",
          volume / 100,
          "muted =",
          false
        );
      } catch (e) {
        console.error("Error setting backup audio:", e);
      }
    }

    // Sử dụng giá trị mới nhất cho socket event
    socket?.emit("video_ready", {
      roomId: currentRoomId,
      videoId: currentVideoId,
    });

    // Thêm delay nhỏ để đảm bảo video dự phòng có thể bắt đầu mà không bị xung đột
    setTimeout(() => {
      onVideoReady();

      // Auto play backup video and hide YouTube player
      if (backupVideoRef.current) {
        console.log(
          "Starting playback of backup video with delay to prevent conflicts"
        );

        // Đảm bảo volume được thiết lập trước khi phát
        backupVideoRef.current.volume = volume / 100;

        // Đảm bảo video không bị tắt tiếng
        backupVideoRef.current.muted = false;

        backupVideoRef.current
          .play()
          .then(() => {
            console.log("Backup video playing successfully");
          })
          .catch((error) => {
            console.error("Error auto-playing backup video:", error);
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
                      console.error(
                        "Still couldn't play after user interaction:",
                        e
                      )
                    );
                }
              },
              { once: true }
            );
          });
      }
    }, 100); // Giảm delay xuống 100ms để bắt đầu phát nhanh hơn
  }, [socket, onVideoReady, volume]);

  // Handler for backup video error
  const handleVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      console.error("Error playing backup video:", e);

      // Không hiển thị lỗi, chỉ đơn giản là đặt lại trạng thái
      setBackupState((prev) => ({
        ...prev,
        backupUrl: "", // Xóa URL để có thể thử lại nếu cần
        backupVideoReady: false,
        isLoadingBackup: false, // Đảm bảo trạng thái loading đã tắt
      }));

      // Có thể thử tải lại video YouTube nếu backup có lỗi
      // Hoặc âm thầm thông báo cho server về vấn đề
    },
    []
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
