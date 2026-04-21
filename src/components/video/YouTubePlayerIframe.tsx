/* eslint-disable @typescript-eslint/no-explicit-any */
import { FC, useEffect, useRef, useState } from "react";
import { YouTubePlayerRef } from "./types";
import {
  applyInitialPlaybackQualityIfFallback,
  enforceFallbackQualityOnChange,
} from "./youtubePlaybackQuality";

const IS_DEV = import.meta.env.DEV || import.meta.env.MODE === "development";
const devLog = (...args: unknown[]) => {
  if (IS_DEV) console.log(...args);
};
const devWarn = (...args: unknown[]) => {
  if (IS_DEV) console.warn(...args);
};
const devError = (...args: unknown[]) => {
  if (IS_DEV) console.error(...args);
};

// Dùng domain chính youtube.com. Trước đây thử youtube-nocookie.com nhưng
// một số video bị hạn chế embed qua nocookie + WebView Android cũ trên
// đầu box có thể stuck load → quay lại youtube.com cho tương thích.
const YOUTUBE_EMBED_HOST = "https://www.youtube.com";

// Biến global để theo dõi trạng thái
let isYouTubeApiLoaded = !!(window as any).YT && !!(window as any).YT.Player;
let globalYouTubePlayer: any = null;

interface YouTubePlayerIframeProps {
  playerRef: React.RefObject<YouTubePlayerRef>;
  videoId: string | undefined;
  onReady: (event: any) => void;
  onStateChange: (event: any) => void;
  onError: (event: any) => void;
  onPlaybackQualityChange: (event: any) => void;
  isFallback: boolean;
  fallbackVideoId: string;
  startSeconds?: number;
  showControls?: boolean;
}

const YouTubePlayerIframe: FC<YouTubePlayerIframeProps> = ({
  playerRef,
  videoId,
  onReady,
  onStateChange,
  onError,
  onPlaybackQualityChange,
  isFallback,
  fallbackVideoId,
  startSeconds,
  showControls = false,
}) => {
  const [apiLoaded, setApiLoaded] = useState(isYouTubeApiLoaded);
  const lastVideoIdRef = useRef<string | undefined>(videoId);
  const initializingRef = useRef(false);
  const playerInitializedRef = useRef(false);

  // Wrapper function for onReady to ensure playerRef is properly set
  const handleOnReady = (event: any) => {
    try {
      // Retrieve the player object
      const player = event.target;

      // Test each method by actually calling it (in a safe way)
      // This ensures the 'this' context is valid
      let hasValidMethods = false;

      try {
        // // Try to get current video data (this is a common source of 'this is undefined' errors)
        // // eslint-disable-next-line @typescript-eslint/no-unused-vars
        // const videoData = player.getVideoData();
        // // Try to get current time and duration (just to verify they work with proper 'this' binding)
        // // eslint-disable-next-line @typescript-eslint/no-unused-vars
        // const currentTime = player.getCurrentTime();
        // // eslint-disable-next-line @typescript-eslint/no-unused-vars
        // const duration = player.getDuration();

        // Make sure the methods needed for playback control exist
        hasValidMethods =
          typeof player.seekTo === "function" &&
          typeof player.playVideo === "function" &&
          typeof player.pauseVideo === "function" &&
          typeof player.loadVideoById === "function" &&
          typeof player.setPlaybackQuality === "function";

        devLog("YouTube player successfully initialized with methods");

        try {
          if (player && typeof player.unloadModule === "function") {
            player.unloadModule("captions");
          }
          if (player && typeof player.setOption === "function") {
            player.setOption("captions", "track", {});
            player.setOption("captions", "reload", false);
            player.setOption("captions", "track", { languageCode: "" });
          }
        } catch (e) {
          devError("Error disabling captions:", e);
        }
      } catch (methodError) {
        devError("Error verifying YouTube player methods:", methodError);
        hasValidMethods = false;
      }

      if (!hasValidMethods) {
        devError(
          "YouTube player is missing required methods or has invalid context"
        );

        if (!initializingRef.current) {
          setTimeout(() => {
            devLog("Attempting to reinitialize YouTube player...");
            initializingRef.current = false;
            playerInitializedRef.current = false;
          }, 1000);
        }
        return;
      }

      applyInitialPlaybackQualityIfFallback(player, isFallback);

      // Update references only when we've verified the methods work
      // @ts-expect-error - bỏ qua lỗi TypeScript
      playerRef.current = player;
      globalYouTubePlayer = player;
      playerInitializedRef.current = true;

      onReady(event);
    } catch (error) {
      devError("Fatal error in YouTube player onReady handler:", error);
    }
  };

  useEffect(() => {
    // Nếu đã có player toàn cục và chưa có player ref, gán nó
    if (
      globalYouTubePlayer &&
      !playerRef.current &&
      !playerInitializedRef.current
    ) {
      try {
        // Verify the global player has required methods
        const hasAllMethods =
          typeof globalYouTubePlayer.getVideoData === "function" &&
          typeof globalYouTubePlayer.getCurrentTime === "function" &&
          typeof globalYouTubePlayer.getDuration === "function";

        if (hasAllMethods) {
          // @ts-expect-error - bỏ qua lỗi TypeScript
          playerRef.current = globalYouTubePlayer;
          playerInitializedRef.current = true;
        } else {
          devWarn("Global YouTube player exists but has missing methods");
          globalYouTubePlayer = null;
        }
      } catch (error) {
        devError("Error assigning global YouTube player:", error);
      }
    }

    // Nếu API đã được tải
    if ((window as any).YT && (window as any).YT.Player && !apiLoaded) {
      isYouTubeApiLoaded = true;
      setApiLoaded(true);
    }

    // Nếu video ID không thay đổi và player đã tồn tại, không làm gì cả
    if (
      lastVideoIdRef.current === videoId &&
      playerRef.current &&
      playerInitializedRef.current
    ) {
      return;
    }

    // Nếu đang khởi tạo, tránh gọi nhiều lần
    if (initializingRef.current) {
      return;
    }

    lastVideoIdRef.current = videoId;

    const PROD_ORIGIN = "https://video.jozo.com.vn";
    const ORIGIN = import.meta.env.PROD ? PROD_ORIGIN : window.location.origin;

    // Hàm khởi tạo player
    const initializePlayer = () => {
      if (initializingRef.current) return;
      initializingRef.current = true;

      // Nếu player đã tồn tại, chỉ cần load video mới
      if (playerRef.current && playerInitializedRef.current) {
        try {
          const currentVideoId = playerRef.current.getVideoData?.()?.video_id;
          if (videoId && currentVideoId !== videoId) {
            devLog("Tải video mới vào player hiện có:", videoId);
            playerRef.current.loadVideoById({
              videoId: videoId,
              startSeconds: startSeconds ?? 0,
            });
          }
          initializingRef.current = false;
          return;
        } catch (e) {
          devError("Lỗi khi tải video mới:", e);
          playerInitializedRef.current = false;
        }
      }

      const playerContainer = document.getElementById("youtube-player");
      if (!playerContainer) {
        devError("Không tìm thấy container YouTube player");
        initializingRef.current = false;
        return;
      }

      try {
        if (
          globalYouTubePlayer &&
          typeof globalYouTubePlayer.destroy === "function"
        ) {
          try {
            globalYouTubePlayer.destroy();
          } catch (error) {
            devWarn("Error destroying previous player:", error);
          }
          globalYouTubePlayer = null;
        }

        devLog(
          "Khởi tạo YouTube player mới với video:",
          videoId || fallbackVideoId
        );

        const playerVars = {
          autoplay: 1,
          controls: showControls ? 1 : 0,
          modestbranding: 1,
          rel: 0,
          fs: 1,
          iv_load_policy: 3,
          enablejsapi: 1,
          playsinline: 1,
          mute: 0,
          disablekb: 1,
          html5: 1,
          ...(isFallback
            ? {
                vq: "small",
                suggestedQuality: "small" as const,
                quality: "small",
              }
            : {}),
          loop: videoId ? 0 : 1,
          playlist: !videoId ? fallbackVideoId : undefined,
          hl: "vi",
          cc_load_policy: 0,
          cc_lang_pref: "none", // Không ưu tiên ngôn ngữ phụ đề nào
          color: "white",
          origin: ORIGIN,
        };

        globalYouTubePlayer = new (window as any).YT.Player("youtube-player", {
          videoId: videoId || (isFallback ? fallbackVideoId : undefined),
          host: YOUTUBE_EMBED_HOST,
          playerVars,
          events: {
            onReady: handleOnReady,
            onStateChange,
            onPlaybackQualityChange: (event: {
              data: string;
              target?: any;
            }) => {
              onPlaybackQualityChange(event);
              enforceFallbackQualityOnChange(
                isFallback,
                event.data,
                event.target
              );
            },
            onError,
          },
        });

        initializingRef.current = false;
      } catch (error) {
        devError("Lỗi khởi tạo YouTube player:", error);
        initializingRef.current = false;
        playerInitializedRef.current = false;
      }
    };

    if (!apiLoaded && !(window as any).YT) {
      if (
        !document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]'
        )
      ) {
        devLog("Đang tải YouTube API script");
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";

        tag.onload = () => {
          devLog("Tải YouTube API thành công");
          isYouTubeApiLoaded = true;
          setApiLoaded(true);
        };

        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

        (window as any).onYouTubeIframeAPIReady = () => {
          devLog("YouTube iframe API đã sẵn sàng");
          isYouTubeApiLoaded = true;
          setApiLoaded(true);
          initializePlayer();
        };
      }
    } else if (apiLoaded || ((window as any).YT && (window as any).YT.Player)) {
      initializePlayer();
    }

    // Không cần cleanup để tránh tái tạo player
    return () => {
      initializingRef.current = false;
    };
  }, [
    videoId,
    apiLoaded,
    playerRef,
    onReady,
    onStateChange,
    onError,
    onPlaybackQualityChange,
    isFallback,
    fallbackVideoId,
  ]);

  return (
    <div
      id="youtube-player"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    />
  );
};

export default YouTubePlayerIframe;
