import axios from "axios";
import { NowPlayingData } from "./types";

export interface RoomNowPlayingResult {
  nowPlaying: NowPlayingData;
  shouldPlay: boolean;
}

function unwrapPayload(data: unknown): Record<string, unknown> | null {
  if (data == null || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;

  const inner =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : root;

  return inner;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function parseShouldPlay(obj: Record<string, unknown>): boolean {
  const raw =
    obj.status ??
    obj.playbackStatus ??
    obj.playback_state ??
    obj.state ??
    obj.isPlaying ??
    obj.is_playing;

  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (["play", "playing", "true", "1", "on"].includes(s)) return true;
    if (
      ["pause", "paused", "false", "0", "off", "stopped", "stop"].includes(s)
    ) {
      return false;
    }
  }
  return true;
}

function toNowPlaying(obj: Record<string, unknown>): NowPlayingData | null {
  const video_id = pickString(obj, [
    "video_id",
    "videoId",
    "youtube_id",
    "youtubeId",
  ]);
  if (!video_id) return null;

  const title = pickString(obj, ["title", "name"]);
  const thumbnail = pickString(obj, ["thumbnail", "thumb_url", "thumbnailUrl"]);
  const author = pickString(obj, ["author", "artist", "channelTitle"]);

  const duration = Number(obj.duration ?? obj.length ?? 0) || 0;
  const currentTime =
    Number(obj.currentTime ?? obj.current_time ?? obj.seconds ?? 0) || 0;
  const timestamp = Number(obj.timestamp ?? obj.ts) || Date.now();

  return {
    video_id,
    title,
    thumbnail,
    author,
    duration,
    currentTime,
    timestamp,
  };
}

/**
 * GET /room-music/:roomId/now-playing — trạng thái bài hiện tại khi vào phòng.
 * Trả về null nếu không có bài hoặc lỗi mạng (không xóa state hiện có).
 */
export async function fetchRoomNowPlaying(
  roomId: string
): Promise<RoomNowPlayingResult | null> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl || !roomId) return null;

  const base = String(baseUrl).replace(/\/$/, "");
  const url = `${base}/room-music/${encodeURIComponent(roomId)}/now-playing`;

  try {
    const response = await axios.get<unknown>(url, {
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });

    if (response.status === 404 || response.status === 204) return null;
    if (response.status >= 400) return null;

    const obj = unwrapPayload(response.data);
    if (!obj) return null;

    const nowPlaying = toNowPlaying(obj);
    if (!nowPlaying) return null;

    const shouldPlay = parseShouldPlay(obj);

    if (!shouldPlay) {
      return {
        nowPlaying: {
          ...nowPlaying,
          timestamp: Date.now(),
        },
        shouldPlay: false,
      };
    }

    return { nowPlaying, shouldPlay: true };
  } catch {
    return null;
  }
}
