/* eslint-disable @typescript-eslint/no-explicit-any */
import { FC, useEffect, useRef, useState } from "react";
import { YouTubePlayerRef } from "./types";
import {
  applyInitialPlaybackQuality,
  enforcePreferredQualityOnChange,
} from "./youtubePlaybackQuality";
import { resolveLowPowerMode } from "./deviceCapability";
import { devError, devLog } from "@/utils/devLog";

// Detect 1 lần khi module load, cố định trong suốt phiên.
const IS_LOW_POWER = resolveLowPowerMode();

// ID ổn định cho placeholder div — YT.Player sẽ replace element này thành <iframe>.
const PLAYER_ELEMENT_ID = "youtube-player";
const YOUTUBE_EMBED_HOST = "https://www.youtube.com";

/** Ép tắt CC — YouTube hay bật lại khi đổi bài / auto-translate. */
function disableCaptions(player: any) {
  if (!player) return;
  try {
    player.unloadModule?.("captions");
    player.setOption?.("captions", "track", {});
  } catch {
    // ignore — API có thể chưa sẵn sàng
  }
}

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
  /** A retained iframe is inactive while HLS/progressive owns the source. */
  suspended?: boolean;
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
  suspended = false,
}) => {
  const [apiReady, setApiReady] = useState(apiLoaded);
  const playerInstanceRef = useRef<any>(null);
  const initializingRef = useRef(false);
  const playerReadyRef = useRef(false);
  const videoIdRef = useRef(videoId);
  videoIdRef.current = videoId;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

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
    const initialVideoId = videoIdRef.current;
    if (!apiReady || !initialVideoId) return;
    if (playerInstanceRef.current || initializingRef.current) return;

    const container = document.getElementById(PLAYER_ELEMENT_ID);
    if (!container) return;

    initializingRef.current = true;
    let disposed = false;

    try {
      devLog("Khởi tạo YouTube player:", initialVideoId);

      // YT replaces/removes its target. Keep React's host intact so cleanup/setup
      // replay and a future mount always have somewhere to create a fresh iframe.
      const placeholder = document.createElement("div");
      container.replaceChildren(placeholder);
      const player = new (window as any).YT.Player(placeholder, {
        width: "100%",
        height: "100%",
        videoId: initialVideoId,
        host: YOUTUBE_EMBED_HOST,
        playerVars: {
          autoplay: 0, // Parent authorizes playback after ready; never race HLS before ready.
          controls: showControls ? 1 : 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          playsinline: 1,
          disablekb: 1,
          // 0 = không ép hiện CC; tắt hẳn bằng disableCaptions() (YouTube không có param disable).
          cc_load_policy: 0,
          start:
            startSecondsRef.current && startSecondsRef.current > 0
              ? Math.floor(startSecondsRef.current)
              : 0,
        },
        events: {
          onReady: (event: any) => {
            if (disposed) return;
            playerReadyRef.current = true;
            try {
              const target = event.target;
              const wanted = videoIdRef.current;
              const current = target.getVideoData?.()?.video_id;
              if (!suspendedRef.current && wanted && current && current !== wanted) {
                target.loadVideoById({
                  videoId: wanted,
                  startSeconds: startSecondsRef.current ?? 0,
                });
              }
              disableCaptions(target);

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
            if (suspendedRef.current) {
              event.target.mute?.();
              event.target.pauseVideo?.();
              return;
            }
            onReadyRef.current(event);
          },
          onStateChange: (event: any) => {
            if (disposed) return;
            if (suspendedRef.current) {
              if (event?.data === 1 || event?.data === 3) {
                event.target?.mute?.();
                event.target?.pauseVideo?.();
              }
              return;
            }
            // YouTube hay bật lại CC khi BUFFERING / PLAYING / CUED.
            const state = event?.data;
            if (state === 1 || state === 3 || state === 5) {
              disableCaptions(event?.target);
            }
            onStateChangeRef.current(event);
          },
          onError: (event: any) => { if (!disposed && !suspendedRef.current) onErrorRef.current(event); },
          onPlaybackQualityChange: (event: any) => {
            if (disposed) return;
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

    return () => {
      // Invalidate queued callbacks before destroy can dispatch any last events.
      disposed = true;
      const player = playerInstanceRef.current;
      playerInstanceRef.current = null;
      playerReadyRef.current = false;
      initializingRef.current = false;
      if (playerRef.current === player) {
        // @ts-expect-error — clear the same parent ref assigned onReady
        playerRef.current = null;
      }
      try { player?.destroy?.(); } catch (e) { devError("YouTube destroy failed:", e); }
    };
    // Song changes use the load effect below, not destroy/recreate.
  }, [apiReady, playerRef, showControls]);

  // 3. Đổi bài → loadVideoById (tái sử dụng iframe, không destroy).
  // Chỉ phụ thuộc videoId — startSeconds lấy từ ref (luôn mới nhất) để tránh
  // effect chạy lại mỗi render do initialStartSeconds dùng Date.now().
  useEffect(() => {
    if (!playerReadyRef.current) return;
    const player = playerInstanceRef.current;
    if (!player || !videoId) return;
    if (suspended) {
      player.mute?.();
      player.pauseVideo?.();
      return;
    }
    if (typeof player.loadVideoById !== "function") return;

    try {
      const currentId = player.getVideoData?.()?.video_id;
      if (currentId === videoId) return;

      devLog("Load video mới vào player hiện có:", videoId);
      player.loadVideoById({
        videoId,
        startSeconds: startSecondsRef.current ?? 0,
      });
      // CC thường được bật lại sau khi load — ép tắt thêm một nhịp.
      disableCaptions(player);
      window.setTimeout(() => {
        if (playerInstanceRef.current === player) disableCaptions(player);
      }, 500);
    } catch (e) {
      devError("loadVideoById failed:", e);
    }
  }, [videoId, suspended]);

  // React owns the stable host; YT owns only its imperative child iframe.
  return <div id={PLAYER_ELEMENT_ID} style={PLAYER_STYLE} />;
};

const PLAYER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
};

export default YouTubePlayerIframe;
