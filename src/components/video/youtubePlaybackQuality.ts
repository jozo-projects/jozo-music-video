/**
 * Video chính: không gọi setPlaybackQuality — YouTube adaptive (mặc định).
 * Fallback playlist: giữ "small" để nhẹ băng thông.
 */

export const YOUTUBE_QUALITY_FALLBACK = "small" as const;

export type YouTubeQualityTarget = {
  setPlaybackQuality?: (quality: string) => void;
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
