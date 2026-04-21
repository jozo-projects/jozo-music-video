/**
 * Video chính: không gọi setPlaybackQuality — YouTube adaptive (mặc định).
 * Fallback playlist: giữ "small" để nhẹ băng thông.
 */

export const YOUTUBE_QUALITY_FALLBACK = "small" as const;
export const YOUTUBE_QUALITY_NETWORK_CAP = "large" as const; // ~480p for weak connections
export const YOUTUBE_STARTUP_LOW_QUALITY = "large" as const; // ~480p in startup window
export const YOUTUBE_ADAPTIVE_QUALITY = "default" as const;
export const YOUTUBE_STARTUP_LOW_QUALITY_MS = 10_000;
const STARTUP_QUALITY_BLOCKLIST = new Set(["hd1080", "highres"]);

export type YouTubeQualityTarget = {
  setPlaybackQuality?: (quality: string) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    downlink?: number;
    saveData?: boolean;
  };
};

export function safeSetPlaybackQuality(
  target: YouTubeQualityTarget | undefined,
  quality: string
): void {
  if (!target?.setPlaybackQuality) return;
  try {
    target.setPlaybackQuality(quality);
  } catch {
    // Player có thể chưa sẵn sàng
  }
}

/**
 * Chỉ hạ trần chất lượng khi mạng yếu để giảm buffering.
 * Không ép tăng chất lượng khi mạng tốt (để YouTube tự adaptive).
 */
export function shouldCapQualityForWeakNetwork(): boolean {
  const nav = navigator as NavigatorWithConnection;
  const conn = nav.connection;

  if (!conn) return false;
  if (conn.saveData) return true;

  const effectiveType = conn.effectiveType || "";
  if (effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") {
    return true;
  }

  if (typeof conn.downlink === "number" && conn.downlink > 0 && conn.downlink < 2.5) {
    return true;
  }

  return false;
}

/** Chỉ áp dụng khi isFallback — video chính bỏ qua hoàn toàn. */
export function applyInitialPlaybackQualityIfFallback(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean
): void {
  if (!isFallback) return;
  safeSetPlaybackQuality(target, YOUTUBE_QUALITY_FALLBACK);
}

/** Gọi từ onPlaybackQualityChange: chỉ giữ small cho fallback. */
export function enforceFallbackQualityOnChange(
  isFallback: boolean,
  reportedQuality: string,
  target: YouTubeQualityTarget | undefined
): void {
  if (!isFallback || reportedQuality === YOUTUBE_QUALITY_FALLBACK) return;
  safeSetPlaybackQuality(target, YOUTUBE_QUALITY_FALLBACK);
}

/**
 * Video chính: chỉ cap khi mạng yếu, tránh YouTube tự nhảy quality quá cao rồi buffering.
 */
export function applyNetworkAwareQualityCap(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean
): void {
  if (isFallback) return;
  if (!shouldCapQualityForWeakNetwork()) return;
  safeSetPlaybackQuality(target, YOUTUBE_QUALITY_NETWORK_CAP);
}

/** Video chính: vào nhanh bằng chất lượng thấp trong vài giây đầu. */
export function applyStartupLowQuality(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean
): void {
  if (isFallback) return;
  safeSetPlaybackQuality(target, YOUTUBE_STARTUP_LOW_QUALITY);
}

export function shouldForceStartupQualityCap(
  reportedQuality: string,
  isStartupLockActive: boolean,
  isFallback: boolean
): boolean {
  if (isFallback || !isStartupLockActive) return false;
  return STARTUP_QUALITY_BLOCKLIST.has(reportedQuality);
}

/** Trả lại adaptive để YouTube tự chọn chất lượng theo mạng/thiết bị. */
export function restoreAdaptiveQuality(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean
): void {
  if (isFallback) return;
  safeSetPlaybackQuality(target, YOUTUBE_ADAPTIVE_QUALITY);
}
