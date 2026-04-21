/**
 * Lưu ý quan trọng: YouTube IFrame API đã deprecate setPlaybackQuality.
 * Với video chính: để YouTube tự adaptive theo mạng/kích thước player.
 * Với fallback (audio-only, iframe ẩn): cố set "small" để tiết kiệm băng thông,
 *   YouTube có thể bỏ qua nhưng vẫn đáng thử vì không tốn gì.
 */

export const YOUTUBE_QUALITY_FALLBACK = "small" as const;
export const YOUTUBE_ADAPTIVE_QUALITY = "default" as const;

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

/** Chỉ áp dụng khi isFallback — video chính để YouTube tự quyết. */
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
