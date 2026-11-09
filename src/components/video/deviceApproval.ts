export interface ApprovalRequest {
  proof: string;
  id?: string | number;
  terminal?: "expired" | "revoked" | "rejected";
}

export function makeProof(crypto: Pick<Crypto, "getRandomValues">): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function loadRequest(storage: Storage, roomId: number, generate: () => string): ApprovalRequest {
  const key = `jozo-device-approval:${roomId}`;
  const raw = storage.getItem(key);
  if (raw) {
    const request = JSON.parse(raw) as ApprovalRequest;
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(request.proof)) throw new Error("Invalid saved approval request");
    return request;
  }
  const request = { proof: generate() };
  storage.setItem(key, JSON.stringify(request));
  return request;
}

// Proof-bearing endpoints must be explicitly configured. Plain HTTP is only
// suitable for local development networks; production deployments need TLS.
export function trustedEndpoint(configured: string | undefined): URL | null {
  try {
    if (!configured) return null;
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    const parts = host.split(".").map(Number);
    const privateIp = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254));
    const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" || privateIp;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url;
  } catch { /* invalid URL */ }
  return null;
}

export function trustedHeaders(url: string, proof: string | undefined, configured: string | undefined): Record<string, string> {
  try {
    const base = trustedEndpoint(configured);
    if (proof && base && new URL(url).origin === base.origin) return { "X-Jozo-Device-Proof": proof };
  } catch { /* invalid URL */ }
  return {};
}
