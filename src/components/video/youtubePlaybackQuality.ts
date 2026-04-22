/**
 * Lưu ý quan trọng: YouTube IFrame API đã deprecate setPlaybackQuality.
 * Với video chính: để YouTube tự adaptive theo mạng/kích thước player.
 * Với fallback (audio-only, iframe ẩn): cố set "small" để tiết kiệm băng thông.
 * Với thiết bị yếu (Android TV box, mạng VN không ổn định): cố set "medium"
 *   để tránh rebuffer giữa bài (bitrate thấp hơn 1080p ~3x).
 *
 * YouTube có thể bỏ qua, nhưng vẫn đáng thử vì không tốn gì.
 */

export const YOUTUBE_QUALITY_FALLBACK = "small" as const;
export const YOUTUBE_QUALITY_LOW_POWER = "medium" as const;
export const YOUTUBE_ADAPTIVE_QUALITY = "default" as const;

// Thứ tự chất lượng từ thấp đến cao — dùng để check "đang cao hơn cap".
const QUALITY_ORDER: Record<string, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  hd720: 4,
  hd1080: 5,
  hd1440: 6,
  hd2160: 7,
  highres: 8,
};

function isQualityHigherThan(current: string, cap: string): boolean {
  const currentRank = QUALITY_ORDER[current];
  const capRank = QUALITY_ORDER[cap];
  if (currentRank === undefined || capRank === undefined) return false;
  return currentRank > capRank;
}

export type YouTubeQualityTarget = {
  setPlaybackQuality?: (quality: string) => void;
};

function safeSetPlaybackQuality(
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
 * Set chất lượng ban đầu:
 *  - isFallback → "small" (audio-only, iframe ẩn)
 *  - isLowPower (và không fallback) → "medium" (cap ~360p/480p)
 *  - Khác → để YouTube tự adaptive
 */
export function applyInitialPlaybackQuality(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean,
  isLowPower: boolean
): void {
  if (isFallback) {
    safeSetPlaybackQuality(target, YOUTUBE_QUALITY_FALLBACK);
    return;
  }
  if (isLowPower) {
    safeSetPlaybackQuality(target, YOUTUBE_QUALITY_LOW_POWER);
  }
}

/** Giữ lại để không break import cũ (chỉ fallback). */
export function applyInitialPlaybackQualityIfFallback(
  target: YouTubeQualityTarget | undefined,
  isFallback: boolean
): void {
  applyInitialPlaybackQuality(target, isFallback, false);
}

/**
 * Gọi từ onPlaybackQualityChange:
 *  - isFallback → luôn cố giữ "small"
 *  - isLowPower → nếu YouTube tự nâng lên cao hơn "medium" thì ép lại
 */
export function enforcePreferredQualityOnChange(
  isFallback: boolean,
  isLowPower: boolean,
  reportedQuality: string,
  target: YouTubeQualityTarget | undefined
): void {
  if (isFallback) {
    if (reportedQuality !== YOUTUBE_QUALITY_FALLBACK) {
      safeSetPlaybackQuality(target, YOUTUBE_QUALITY_FALLBACK);
    }
    return;
  }
  if (
    isLowPower &&
    isQualityHigherThan(reportedQuality, YOUTUBE_QUALITY_LOW_POWER)
  ) {
    safeSetPlaybackQuality(target, YOUTUBE_QUALITY_LOW_POWER);
  }
}

/** Giữ lại để không break import cũ. */
export function enforceFallbackQualityOnChange(
  isFallback: boolean,
  reportedQuality: string,
  target: YouTubeQualityTarget | undefined
): void {
  enforcePreferredQualityOnChange(isFallback, false, reportedQuality, target);
}
