const DEVICE_ID_KEY = "jozo-video-device-id";

/** Lấy hoặc tạo deviceId ổn định để BE đăng ký connection registry. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const deviceId = `video-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
  } catch {
    return `video-${crypto.randomUUID()}`;
  }
}
