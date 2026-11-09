import { useEffect, useRef, useState } from "react";
import { logo } from "../../assets";
import RoomSelectModal from "./RoomSelectModal";
import io from "socket.io-client";
import { useSearchParams } from "react-router-dom";
import VideoPlayer from "./VideoPlayer";
import {
  ApprovalRequest,
  loadRequest,
  makeProof,
  trustedEndpoint,
} from "./deviceApproval";

class RateLimited extends Error {
  constructor(readonly seconds: number) { super("RATE_LIMITED"); }
}

type Status =
  | "checking"
  | "pending"
  | "approved"
  | "expired"
  | "revoked"
  | "rejected"
  | "error";

function ApprovalGate({ roomId }: { roomId: number }) {
  const [status, setStatus] = useState<Status>("checking");
  const [proof, setProof] = useState<string>();
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const triggerRef = useRef<(() => void) | null>(null);
  const blockedUntil = useRef(0);
  const [params] = useSearchParams();
  useEffect(() => {
    if (retryAt <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt, now]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = `jozo-device-approval:${roomId}`;
    const base = import.meta.env.VITE_API_BASE_URL;
    let request: ApprovalRequest;
    let socket: ReturnType<typeof io> | undefined;
    let socketKey = "";
    let running = false;
    let dirty = false;
    let controller: AbortController | undefined;
    const save = () => localStorage.setItem(key, JSON.stringify(request));
    const post = async (path: string, body: object) => {
      const baseUrl = trustedEndpoint(base);
      if (!baseUrl)
        throw new Error(
          "Approval API must be explicitly configured with a trusted URL",
        );
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(
          `${baseUrl.href.replace(/\/$/, "")}/room-device-authorization/${path}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (response.status === 429) {
          const body = await response.json().catch(() => ({}));
          const seconds = Number(body.retryAfterSeconds);
          throw new RateLimited(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60);
        }
        if (!response.ok) throw new Error("Approval request failed");
        return await response.json();
      } finally {
        clearTimeout(timeout);
        controller = undefined;
      }
    };
    const trigger = () => {
      if (cancelled) return;
      clearTimeout(timer);
      if (Date.now() < blockedUntil.current) {
        timer = setTimeout(trigger, blockedUntil.current - Date.now());
        return;
      }
      dirty = true;
      if (!running) void run();
    };
    const run = async () => {
      running = true;
      dirty = false;
      try {
        request = loadRequest(localStorage, roomId, () => makeProof(window.crypto));
        if (request.terminal === "rejected") {
          setProof(undefined);
          setStatus("rejected");
        } else if (request.terminal) {
          socket?.disconnect();
          socket = undefined;
          socketKey = "";
          request = { proof: makeProof(window.crypto) };
          save();
        }
        if (!request.id) {
          const result = await post("requests", { roomId, clientType: "video", proof: request.proof });
          if (cancelled) return;
          if ((typeof result.id !== "string" && typeof result.id !== "number") || !result.id)
            throw new Error("Invalid request response");
          const stored = loadRequest(localStorage, roomId, () => makeProof(window.crypto));
          if (stored.proof !== request.proof) { dirty = true; return; }
          request.id = result.id;
          save();
        }
        const currentKey = JSON.stringify([request.id, request.proof]);
        if (currentKey !== socketKey) {
          socket?.disconnect();
          socket = undefined;
          socketKey = currentKey;
          const endpoint = trustedEndpoint(import.meta.env.VITE_SOCKET_URL);
          if (endpoint) {
            socket = io(`${endpoint.origin}/device-authorization`, {
              auth: { roomId, clientType: "video", id: request.id, proof: request.proof },
              transports: ["websocket"], forceNew: true,
            });
            socket.on("connect", trigger);
            socket.on("device_authorization_changed", trigger);
          }
        }
        const result = await post("status", { roomId, clientType: "video", id: request.id, proof: request.proof });
        if (cancelled || dirty) return;
        // Do not apply a response to a request replaced in another tab.
        const stored = loadRequest(localStorage, roomId, () => makeProof(window.crypto));
        if (stored.proof !== request.proof || stored.id !== request.id) { dirty = true; return; }
        if (!["pending", "approved", "expired", "revoked", "rejected"].includes(result.status))
          throw new Error("Invalid status");
        if (result.status === "expired" || result.status === "revoked" || result.status === "rejected") {
          request.terminal = result.status;
          save();
          setProof(undefined);
          setStatus(result.status);
          if (result.status !== "rejected") dirty = true;
        } else {
          if (request.terminal) { delete request.terminal; save(); }
          setProof(result.status === "approved" ? request.proof : undefined);
          setStatus(result.status);
        }
      } catch (error) {
        if (!cancelled && error instanceof RateLimited) {
          dirty = false;
          blockedUntil.current = Date.now() + error.seconds * 1000;
          setNow(Date.now());
          setRetryAt(blockedUntil.current);
        }
        if (!cancelled && !dirty) {
          setStatus((previous) => previous === "approved" || previous === "rejected" ? previous : "error");
        }
      } finally {
        running = false;
        if (!cancelled) {
          if (dirty) void run();
          else timer = setTimeout(trigger, Math.max(0, blockedUntil.current - Date.now()) || (request?.terminal === "rejected" ? 7000 : 30000));
        }
      }
    };
    triggerRef.current = trigger;
    trigger();
    return () => {
      triggerRef.current = null;
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      socket?.disconnect();
    };
  }, [roomId]);

  if (status === "approved" && proof)
    return <VideoPlayer deviceProof={proof} />;
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black p-6 text-center text-white">
      <button type="button" onClick={() => setShowRoomModal(true)} className="absolute right-[15px] top-[15px] h-[50px] w-[140px]" aria-label="Chọn phòng Jozo"><img src={logo} alt="Jozo" className="h-full w-full" /></button>
      <div>
        <h1 className="text-xl font-bold">Phê duyệt thiết bị phòng {roomId}</h1>
        <p className="mt-4 text-white/70" role="status">
          {status === "pending"
            ? "Đang chờ quản trị viên phê duyệt thiết bị."
            : status === "expired"
              ? "Yêu cầu đã hết hạn. Đang gửi lại…"
              : status === "revoked"
                ? "Quyền thiết bị đã bị thu hồi. Đang gửi yêu cầu mới…"
                : status === "rejected"
                  ? "Yêu cầu bị từ chối. Liên hệ nhân viên"
                  : status === "error"
                    ? remaining > 0 && blockedUntil.current > now ? `Đang có nhiều yêu cầu. Thử lại sau ${remaining} giây…` : "Không thể kết nối. Đang thử lại…"
                    : "Đang kiểm tra thiết bị…"}
        </p>
      </div>
      <RoomSelectModal
        open={showRoomModal}
        currentRoomId={String(roomId)}
        onClose={() => setShowRoomModal(false)}
        onSelect={(selected) => {
          if (selected === roomId) { setShowRoomModal(false); return; }
          const next = new URLSearchParams(params);
          next.set("roomId", String(selected));
          window.location.assign(`${window.location.pathname}?${next.toString()}`);
        }}
        onReconnect={() => {
          if (status === "rejected" || Date.now() < retryAt) return;
          const at = Date.now();
          setNow(at);
          setRetryAt(at + 5000);
          triggerRef.current?.();
        }}
        reconnectDisabled={status === "rejected" || remaining > 0}
        reconnectMessage={status === "rejected" ? "Yêu cầu bị từ chối. Liên hệ nhân viên để cho phép gửi lại." : remaining > 0 ? `Vui lòng chờ ${remaining} giây.` : status === "pending" ? "Thiết bị đang chờ nhân viên duyệt." : undefined}
      />
    </div>
  );
}

export default function VideoApprovalEntry() {
  const [params] = useSearchParams();
  const room = params.get("roomId") || "";
  if (
    (import.meta.env.VITE_DEVICE_AUTHORIZATION ??
      import.meta.env.VITE_DEVICE_APPROVAL_ENABLED) !== "true" ||
    !room
  )
    return <VideoPlayer />;
  const roomId = Number(room);
  if (!Number.isSafeInteger(roomId) || roomId <= 0)
    return <div role="alert">Phòng không hợp lệ.</div>;
  return <ApprovalGate key={roomId} roomId={roomId} />;
}
