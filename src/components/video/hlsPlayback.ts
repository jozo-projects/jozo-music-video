import Hls from "hls.js";
import { isHlsUrl } from "../../utils/hls";

const WATCHDOG_MS = 8000;
const MAX_RECOVERIES = 2;

interface PlaybackOptions {
  video: HTMLVideoElement;
  url: string;
  desiredPlaying?: boolean;
  initialPosition?: number;
  isCurrent: () => boolean;
  onReady: () => void;
  onEnded: () => void;
  onUnsupported: () => void;
  onRetryVisible: (visible: boolean) => void;
  onLoadingChange?: (loading: boolean) => void;
}

// One owner per queue identity. Attempts are disposable, the budget is not.
export function createHlsPlayback(options: PlaybackOptions) {
  const { video, url } = options;
  let disposed = false;
  let generation = 0;
  let recoveries = 0;
  let readyNotified = false;
  let ended = false;
  let unsupportedNotified = false;
  let wanted = options.desiredPlaying ?? true;
  let controlled = options.desiredPlaying !== undefined;
  const initialPosition = options.initialPosition;
  let position = initialPosition !== undefined && Number.isFinite(initialPosition) && initialPosition >= 0 ? initialPosition : 0;
  let attemptReady = false;
  let canStart = false;
  let advice = false;
  let lastProgress = performance.now();
  let observedTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let releaseAttempt = () => {};
  const active = () => !disposed && options.isCurrent();
  const showRetry = (reason: string) => {
    if (!active() || advice) return;
    advice = true;
    console.warn("[HLS] manual retry required", { reason, recoveries });
    options.onLoadingChange?.(false);
    options.onRetryVisible(true);
  };
  const rememberPosition = (explicitSeek = false) => {
    if ((attemptReady || explicitSeek) && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
      position = video.currentTime;
    }
  };
  const play = (token: number) => {
    if (!active() || token !== generation || !wanted || !canStart) return;
    try {
      void video.play().catch(() => {
        if (active() && token === generation && wanted) showRetry("play-rejected");
      });
    } catch {
      if (active() && token === generation) showRetry("play-rejected");
    }
  };
  const recover = (reason: string) => {
    if (!active() || ended || advice) return;
    if (recoveries >= MAX_RECOVERIES) {
      showRetry(reason);
      return;
    }
    recoveries++;
    rememberPosition();
    console.info("[HLS] recovering", { reason, attempt: recoveries });
    startAttempt();
  };
  function startAttempt() {
    if (!active()) return;
    // Invalidate before destroy/pause: both may dispatch callbacks synchronously.
    const token = ++generation;
    releaseAttempt();
    if (timer !== undefined) clearTimeout(timer);
    const valid = () => active() && generation === token;
    attemptReady = false;
    canStart = false;
    lastProgress = performance.now();
    observedTime = position;
    options.onLoadingChange?.(true);
    video.pause();
    const listeners: Array<[string, EventListener]> = [];
    const listen = (name: string, fn: () => void) => {
      const guarded = () => { if (valid()) fn(); };
      listeners.push([name, guarded]);
      video.addEventListener(name, guarded);
    };
    let hls: Hls | undefined;
    releaseAttempt = () => {
      listeners.forEach(([name, fn]) => video.removeEventListener(name, fn));
      hls?.destroy();
    };
    let restoring = false;
    const restore = () => {
      if (!attemptReady && position > 0 && Math.abs(video.currentTime - position) > 0.05) {
        restoring = true;
        try { video.currentTime = position; } catch { /* Retry once data arrives. */ }
        finally { restoring = false; }
      }
    };
    const dataReady = () => {
      if (video.readyState < 2) return;
      restore();
      // Seeking can synchronously drop HAVE_CURRENT_DATA back to metadata only.
      if (video.readyState < 2) return;
      options.onLoadingChange?.(false);
      if (!attemptReady) {
        attemptReady = true;
        canStart = true;
        lastProgress = performance.now();
        if (!readyNotified) {
          readyNotified = true;
          options.onReady();
        }
        if (!valid()) return;
        play(token);
      }
    };
    const progress = () => {
      if (attemptReady && video.currentTime !== observedTime) {
        observedTime = video.currentTime;
        rememberPosition();
        lastProgress = performance.now();
        options.onLoadingChange?.(false);
        if (advice && !video.paused) {
          advice = false;
          options.onRetryVisible(false);
        }
      }
    };
    const notifyEnded = () => {
      if (!attemptReady || ended) return;
      const atEnd = video.ended || (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.75);
      if (!atEnd) return;
      ended = true;
      if (timer !== undefined) clearTimeout(timer);
      options.onEnded();
    };
    listen("loadedmetadata", restore);
    listen("loadeddata", dataReady);
    listen("canplay", dataReady);
    listen("waiting", () => { if (wanted && !advice) options.onLoadingChange?.(true); });
    listen("timeupdate", progress);
    // Parent remote controls seek the real element even before recovery has data.
    // Our restore may synchronously dispatch seeking; do not feed it back. A
    // queued restore event sees the same position and is harmless as well.
    listen("seeking", () => { if (!restoring) rememberPosition(true); });
    listen("ended", notifyEnded);
    listen("error", () => recover("media-error"));
    listen("pause", () => { if (!controlled) wanted = false; });
    listen("play", () => { if (!controlled) wanted = true; lastProgress = performance.now(); });
    const tick = () => {
      if (!valid() || ended) return;
      progress();
      if (attemptReady && !wanted) lastProgress = performance.now();
      if (!advice && performance.now() - lastProgress >= WATCHDOG_MS) {
        recover(attemptReady ? "stalled" : "startup-timeout");
      }
      if (valid() && !ended) timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
    if (isHlsUrl(url) && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!valid()) return;
        canStart = true;
        play(token);
      });
      hls.on(Hls.Events.MEDIA_ENDED, () => { if (valid()) notifyEnded(); });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (valid() && data.fatal) recover("hls-fatal");
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (!isHlsUrl(url) || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.load();
    } else {
      showRetry("unsupported");
      if (!unsupportedNotified) {
        unsupportedNotified = true;
        options.onUnsupported();
      }
    }
  }
  startAttempt();
  return {
    setPendingPosition(value: number | undefined) {
      if (active() && !attemptReady && value !== undefined && Number.isFinite(value) && value >= 0) position = value;
    },
    setDesiredPlaying(value: boolean | undefined) {
      if (!active()) return;
      controlled = value !== undefined;
      if (value === undefined || value === wanted) return;
      wanted = value;
      lastProgress = performance.now();
      if (wanted) play(generation);
      else video.pause();
    },
    retry() {
      if (!active()) return;
      rememberPosition();
      recoveries = 0; // Only an explicit user action replenishes this identity's budget.
      advice = false;
      options.onRetryVisible(false);
      startAttempt();
      canStart = true;
      play(generation); // Invoke within the user gesture, even before the manifest.
    },
    dispose() {
      disposed = true;
      generation++;
      if (timer !== undefined) clearTimeout(timer);
      releaseAttempt();
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}
