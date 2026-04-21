/**
 * Detect thiết bị low-power (Android TV box, karaoke box chip ARM yếu).
 *
 * Mục đích hiện tại (chỉ CSS-only, an toàn):
 *  - Tắt backdrop-blur real-time → giảm GPU load
 *  - Rút ngắn / tắt animation nặng
 *
 * Lưu ý: detect là best-effort, không chính xác tuyệt đối — ưu tiên
 * false-positive (coi máy yếu khi không chắc) để giữ ổn định cho tv-box.
 */

type NavigatorWithCapability = Navigator & {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: {
    saveData?: boolean;
  };
};

function hasAndroidUserAgent(ua: string): boolean {
  return /android/i.test(ua);
}

function isLikelyMobilePhone(ua: string): boolean {
  // Phone Android thường có "Mobile" trong UA, TV/box thì không.
  return /android/i.test(ua) && /mobile/i.test(ua);
}

function isAndroidTvBox(ua: string): boolean {
  if (!hasAndroidUserAgent(ua)) return false;
  if (isLikelyMobilePhone(ua)) return false;
  // Android không có "Mobile" → gần như chắc chắn là TV / box / tablet
  return true;
}

function isKnownWeakDevice(ua: string): boolean {
  // Một số UA fingerprint của karaoke box / Android TV phổ biến ở VN
  return /(allwinner|rockchip|amlogic|mtk|mediatek|hisi|armv7|armv8|aarch64)/i.test(ua);
}

/** Tổng hợp các dấu hiệu thiết bị yếu. */
export function detectLowPowerDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as NavigatorWithCapability;
  const ua = nav.userAgent || "";

  // 1. User bật Data Saver → respect luôn
  if (nav.connection?.saveData) return true;

  // 2. RAM thấp (navigator.deviceMemory là GB, có thể undefined)
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) {
    return true;
  }

  // 3. CPU ít core (Android box thường 4 core chậm, ≤ 4 là dấu hiệu yếu)
  if (
    typeof nav.hardwareConcurrency === "number" &&
    nav.hardwareConcurrency > 0 &&
    nav.hardwareConcurrency <= 4 &&
    hasAndroidUserAgent(ua)
  ) {
    return true;
  }

  // 4. Android không phải điện thoại → tv/box
  if (isAndroidTvBox(ua)) return true;

  // 5. UA fingerprint của chip yếu
  if (isKnownWeakDevice(ua)) return true;

  return false;
}

/**
 * Cho phép override qua query param `?lowPower=1` hoặc `?lowPower=0`
 * để debug nhanh trên thiết bị thật.
 */
export function resolveLowPowerMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("lowPower");
    if (override === "1" || override === "true") return true;
    if (override === "0" || override === "false") return false;
  } catch {
    // ignore
  }
  return detectLowPowerDevice();
}
