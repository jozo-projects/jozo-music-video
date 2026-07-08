export function getLocalServerUrl(): string {
  return import.meta.env.VITE_API_LOCAL_SERVER?.replace(/\/$/, "") ?? "";
}

export function buildHlsUrl(videoId: string): string {
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
  const base = getLocalServerUrl();
  if (!base || !videoId) return "";

  if (/^[a-f\d]{24}$/i.test(videoId)) {
    return buildHlsUrl(videoId);
  }

  try {
    const res = await fetch(`${base}/api/media/video/${encodeURIComponent(videoId)}`);
    if (!res.ok) return "";
    const json = (await res.json()) as { data?: { status?: string; hlsUrl?: string } };
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
