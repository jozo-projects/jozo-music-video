export function getLocalServerUrl(): string {
  return import.meta.env.VITE_API_LOCAL_SERVER?.replace(/\/$/, "") || "";
}

/**
 * Local worker HLS discovery is an explicit development-only escape hatch.
 * Production playback must discover hls_url from BE/catalog and never call :4001.
 */
export function isLocalHlsFallbackEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_LOCAL_HLS_FALLBACK === "true"
  );
}

export function buildHlsUrl(videoId: string): string {
  if (/^https?:\/\/.+\.m3u8(?:\?.*)?$/i.test(videoId)) {
    return videoId;
  }

  if (!isLocalHlsFallbackEnabled()) return "";
  const base = getLocalServerUrl();
  if (!base || !videoId) return "";
  // Test mode: truyền Mongo media id trực tiếp
  if (/^[a-f\d]{24}$/i.test(videoId)) {
    return `${base}/hls/${videoId}/hls/index.m3u8`;
  }
  return "";
}

/** Lấy hlsUrl từ local worker theo YouTube videoId. */
export async function resolveHlsUrl(videoId: string): Promise<string> {
  if (!isLocalHlsFallbackEnabled()) return "";
  const base = getLocalServerUrl();
  if (!base || !videoId) return "";

  if (/^[a-f\d]{24}$/i.test(videoId)) {
    return buildHlsUrl(videoId);
  }

  try {
    const res = await fetch(
      `${base}/api/media/video/${encodeURIComponent(videoId)}`,
    );
    if (!res.ok) return "";
    const json = (await res.json()) as {
      data?: { status?: string; hlsUrl?: string };
    };
    if (json.data?.status === "ready" && json.data.hlsUrl) {
      return json.data.hlsUrl;
    }
  } catch {
    // ignore
  }
  return "";
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}
