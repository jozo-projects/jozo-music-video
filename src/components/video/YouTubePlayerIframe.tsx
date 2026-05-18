/* eslint-disable @typescript-eslint/no-explicit-any */
import { FC, useEffect, useRef, useState } from "react";
import { YouTubePlayerRef } from "./types";
import {
  applyInitialPlaybackQuality,
  enforcePreferredQualityOnChange,
} from "./youtubePlaybackQuality";
import { resolveLowPowerMode } from "./deviceCapability";

// Detect 1 lần khi module load, cố định trong suốt phiên.
const IS_LOW_POWER = resolveLowPowerMode();
const IS_DEV = import.meta.env.DEV;

const devLog = (...args: unknown[]) => {
  if (IS_DEV) console.log(...args);
};
const devError = (...args: unknown[]) => {
  if (IS_DEV) console.error(...args);
};

// ID ổn định cho placeholder div — YT.Player sẽ replace element này thành <iframe>.
const PLAYER_ELEMENT_ID = "youtube-player";
const YOUTUBE_EMBED_HOST = "https://www.youtube.com";

// ---------------- YT IFrame API loader (global, load 1 lần) ----------------
let apiLoaded = !!(window as any).YT && !!(window as any).YT.Player;
let apiLoadingPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (apiLoaded) return Promise.resolve();
  if (apiLoadingPromise) return apiLoadingPromise;

  apiLoadingPromise = new Promise<void>((resolve) => {
    const finish = () => {
      apiLoaded = true;
      resolve();
    };

    // API có thể đã sẵn trong window nhưng flag chưa kịp cập nhật
    if ((window as any).YT && (window as any).YT.Player) {
      finish();
      return;
    }

    const prevCb = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      try {
        prevCb?.();
      } catch {
        // ignore
      }
      finish();
    };

    if (
      !document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]'
      )
    ) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return apiLoadingPromise;
}

// ---------------- Component ----------------
interface YouTubePlayerIframeProps {
  playerRef: React.RefObject<YouTubePlayerRef>;
  videoId: string;
  onReady: (event: any) => void;
  onStateChange: (event: any) => void;
  onError: (event: any) => void;
  onPlaybackQualityChange: (event: any) => void;
  isFallback?: boolean;
  startSeconds?: number;
  showControls?: boolean;
}

/**
 * Player IFrame YouTube đơn giản hoá:
 *  - Khởi tạo iframe MỘT lần duy nhất cho cả vòng đời component.
 *  - Đổi bài = loadVideoById (không destroy/create iframe).
 *  - Callback cha truyền vào được lưu trong ref → parent re-render
 *    không làm effect chạy lại.
 *  - Cha chỉ nên mount component này khi thực sự có bài để phát.
 */
const YouTubePlayerIframe: FC<YouTubePlayerIframeProps> = ({
  playerRef,
  videoId,
  onReady,
  onStateChange,
  onError,
  onPlaybackQualityChange,
  isFallback = false,
  startSeconds,
  showControls = false,
}) => {
  const [apiReady, setApiReady] = useState(apiLoaded);
  const playerInstanceRef = useRef<any>(null);
  const initializingRef = useRef(false);

  // Ref-hoá callback để effect init không phụ thuộc vào hàm parent.
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  const onQualityRef = useRef(onPlaybackQualityChange);
  onReadyRef.current = onReady;
  onStateChangeRef.current = onStateChange;
  onErrorRef.current = onError;
  onQualityRef.current = onPlaybackQualityChange;

  // Cố định flag isFallback tại thời điểm init — tránh effect init phụ thuộc
  // vào prop thay đổi và đụng độ với việc reuse player.
  const isFallbackAtInitRef = useRef(isFallback);
  isFallbackAtInitRef.current = isFallback;

  // Ref hoá startSeconds để effect init/load không cần startSeconds trong deps.
  // startSeconds (initialStartSeconds) dùng Date.now() nên thay đổi mỗi render —
  // nếu để trong deps sẽ khiến Effect #3 chạy liên tục và có thể trigger
  // loadVideoById khi getVideoData() tạm thời trả về giá trị không đúng.
  const startSecondsRef = useRef(startSeconds);
  startSecondsRef.current = startSeconds;

  // 1. Load YT IFrame API.
  useEffect(() => {
    if (apiReady) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (!cancelled) setApiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [apiReady]);

  // 2. Khởi tạo player 1 lần khi API sẵn sàng và có videoId.
  useEffect(() => {
    if (!apiReady || !videoId) return;
    if (playerInstanceRef.current || initializingRef.current) return;

    const container = document.getElementById(PLAYER_ELEMENT_ID);
    if (!container) return;

    initializingRef.current = true;

    try {
      devLog("Khởi tạo YouTube player:", videoId);

      const player = new (window as any).YT.Player(PLAYER_ELEMENT_ID, {
        videoId,
        host: YOUTUBE_EMBED_HOST,
        playerVars: {
          autoplay: 1,
          controls: showControls ? 1 : 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          playsinline: 1,
          disablekb: 1,
          cc_load_policy: 0,
          cc_lang_pref: "none",
          hl: "vi",
          start:
            startSecondsRef.current && startSecondsRef.current > 0
              ? Math.floor(startSecondsRef.current)
              : 0,
        },
        events: {
          onReady: (event: any) => {
            try {
              const target = event.target;
              // Tắt captions — mặc định tv-box hay bật tiếng Việt auto-translate.
              try {
                target.unloadModule?.("captions");
                target.setOption?.("captions", "track", {});
              } catch {
                // ignore
              }

              applyInitialPlaybackQuality(
                target,
                isFallbackAtInitRef.current,
                IS_LOW_POWER
              );

              // @ts-expect-error — gán player vào ref cha
              playerRef.current = target;
            } catch (e) {
              devError("onReady setup error:", e);
            }
            onReadyRef.current(event);
          },
          onStateChange: (event: any) => onStateChangeRef.current(event),
          onError: (event: any) => onErrorRef.current(event),
          onPlaybackQualityChange: (event: any) => {
            onQualityRef.current(event);
            enforcePreferredQualityOnChange(
              isFallbackAtInitRef.current,
              IS_LOW_POWER,
              event?.data,
              event?.target
            );
          },
        },
      });

      playerInstanceRef.current = player;
    } catch (e) {
      devError("Lỗi khởi tạo YouTube player:", e);
    } finally {
      initializingRef.current = false;
    }

    // Không cleanup destroy — giữ 1 player duy nhất cho vòng đời component.
    // Khi unmount (queue clear), React sẽ remove placeholder div → iframe bị
    // gỡ theo, destroy thủ công không cần thiết.
  // startSeconds được đọc từ startSecondsRef (luôn mới nhất) nên không cần
  // trong deps — tránh re-run effect mỗi khi Date.now() thay đổi.
  }, [apiReady, videoId, playerRef, showControls]);

  // 3. Đổi bài → loadVideoById (tái sử dụng iframe, không destroy).
  // Chỉ phụ thuộc videoId — startSeconds lấy từ ref (luôn mới nhất) để tránh
  // effect chạy lại mỗi render do initialStartSeconds dùng Date.now().
  useEffect(() => {
    const player = playerInstanceRef.current;
    if (!player || !videoId) return;
    if (typeof player.loadVideoById !== "function") return;

    try {
      const currentId = player.getVideoData?.()?.video_id;
      if (currentId === videoId) return;

      devLog("Load video mới vào player hiện có:", videoId);
      player.loadVideoById({
        videoId,
        startSeconds: startSecondsRef.current ?? 0,
      });
    } catch (e) {
      devError("loadVideoById failed:", e);
    }
  }, [videoId]);

  // Placeholder div — YT.Player replace element này thành <iframe>.
  // Style inline cố định → không thay đổi giữa các render.
  return <div id={PLAYER_ELEMENT_ID} style={PLAYER_STYLE} />;
};

const PLAYER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
};

export default YouTubePlayerIframe;
