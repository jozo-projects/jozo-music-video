import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { getDeviceId } from "@/utils/deviceId";
import { devError, devLog } from "@/utils/devLog";
import { SocketStatus, VideoTurnedOffData } from "../types";

type SocketInstance = ReturnType<typeof io>;
interface SharedConnection {
  roomId: string;
  socket: SocketInstance;
  users: number;
  releaseTimer?: ReturnType<typeof setTimeout>;
  dispose: () => void;
}
let sharedConnection: SharedConnection | null = null;

function createConnection(roomId: string): SharedConnection {
  const socket = io(
    import.meta.env.VITE_SOCKET_URL ||
      (import.meta.env.DEV ? "http://localhost:8080" : ""),
    {
      query: { roomId, deviceId: getDeviceId(), clientType: "video" },
      reconnection: true,
      // Keep recovering from long outages; cap the delay, not the retry count.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      transports: ["websocket", "polling"],
      path: "/socket.io",
      forceNew: true,
    },
  );
  let disposed = false;
  let stopped = false;
  let serverDisconnects = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  const handleDisconnect = (reason: string) => {
    if (disposed) return;
    clearRetry();
    if (reason === "io client disconnect") {
      stopped = true;
    } else if (reason === "io server disconnect" && !stopped) {
      // Socket.IO does not retry a server DISCONNECT. Back off repeated kicks
      // too, rather than resetting the delay on every short-lived connection.
      const delay = Math.min(1000 * 2 ** Math.min(serverDisconnects++, 3), 5000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!disposed && !stopped && connection.users > 0) socket.connect();
      }, delay);
    }
  };
  const handleError = (error: Error) => {
    devError("Lỗi kết nối socket:", error.message);
    // v4 namespace middleware rejection sets active=false. Transport failures
    // remain active and are retried by Manager. The current room backend has
    // no custom auth/room rejection event or error code; do not guess strings.
    // The repository also includes legacy @types/socket.io-client, which omits
    // this v4 runtime property. Narrow structurally without an unsafe cast.
    if ("active" in socket && socket.active === false) {
      stopped = true;
      clearRetry();
    }
  };
  const handleOnline = () => {
    if (disposed || stopped || socket.connected || connection.users === 0) return;
    clearRetry();
    socket.connect();
  };
  socket.on("disconnect", handleDisconnect);
  socket.on("connect_error", handleError);
  window.addEventListener("online", handleOnline);
  const connection: SharedConnection = {
    roomId,
    socket,
    users: 0,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearRetry();
      clearTimeout(connection.releaseTimer);
      window.removeEventListener("online", handleOnline);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleError);
      socket.disconnect();
      if (sharedConnection === connection) sharedConnection = null;
    },
  };
  return connection;
}

interface UseSocketConnectionProps {
  roomId: string;
  onConnect: (socket: SocketInstance) => void;
  onVideosOff: () => void;
  onVideosOn: () => void;
}
interface UseSocketConnectionResult {
  socket: SocketInstance | null;
  socketStatus: SocketStatus;
  isVideoOff: boolean;
}

export function useSocketConnection({
  roomId,
  onConnect,
  onVideosOff,
  onVideosOn,
}: UseSocketConnectionProps): UseSocketConnectionResult {
  const [socket, setSocket] = useState<SocketInstance | null>(null);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>({
    connected: false,
    connectionAttempts: 0,
  });
  const onConnectRef = useRef(onConnect);
  const onVideosOffRef = useRef(onVideosOff);
  const onVideosOnRef = useRef(onVideosOn);
  useEffect(() => {
    onConnectRef.current = onConnect;
    onVideosOffRef.current = onVideosOff;
    onVideosOnRef.current = onVideosOn;
  }, [onConnect, onVideosOff, onVideosOn]);

  useEffect(() => {
    if (!roomId) {
      setSocket(null);
      setSocketStatus({ connected: false, connectionAttempts: 0 });
      return;
    }
    if (sharedConnection && sharedConnection.roomId !== roomId) {
      sharedConnection.dispose();
    }
    const connection = sharedConnection ?? createConnection(roomId);
    sharedConnection = connection;
    clearTimeout(connection.releaseTimer);
    connection.users++;
    const socketInstance = connection.socket;
    setSocket(socketInstance);
    setIsVideoOff(false);
    setSocketStatus({ connected: socketInstance.connected, connectionAttempts: 0 });

    const handleConnect = () => {
      devLog("Socket kết nối thành công");
      setSocketStatus({ connected: true, connectionAttempts: 0 });
      // Socket connect fires on initial connection AND reconnect. Manager's
      // reconnect precedes namespace connection and must not hydrate twice.
      onConnectRef.current(socketInstance);
    };
    const handleDisconnect = () => {
      setSocketStatus((prev) => ({ ...prev, connected: false }));
    };
    const handleAttempt = (attempt: number) => {
      setSocketStatus({ connected: false, connectionAttempts: attempt });
    };
    const handleVideosOff = (data: VideoTurnedOffData) => {
      devLog("Videos đã bị tắt bởi backend", data);
      setIsVideoOff(true);
      onVideosOffRef.current();
    };
    const handleVideosOn = () => {
      setIsVideoOff(false);
      onVideosOnRef.current();
    };
    socketInstance.on("connect", handleConnect);
    socketInstance.on("disconnect", handleDisconnect);
    socketInstance.io.on("reconnect_attempt", handleAttempt);
    socketInstance.on("videos_turned_off", handleVideosOff);
    socketInstance.on("videos_turned_on", handleVideosOn);
    if (socketInstance.connected) handleConnect();

    const heartbeatInterval = setInterval(() => {
      if (socketInstance.connected) socketInstance.emit("heartbeat", { roomId });
    }, 60000);
    return () => {
      clearInterval(heartbeatInterval);
      socketInstance.off("connect", handleConnect);
      socketInstance.off("disconnect", handleDisconnect);
      socketInstance.io.off("reconnect_attempt", handleAttempt);
      socketInstance.off("videos_turned_off", handleVideosOff);
      socketInstance.off("videos_turned_on", handleVideosOn);
      connection.users--;
      if (connection.users === 0) {
        // React StrictMode immediately replays setup after cleanup. Allow that
        // replay to reacquire the same transport, but close a real unmount.
        connection.releaseTimer = setTimeout(connection.dispose, 0);
      }
    };
  }, [roomId]);
  return { socket, socketStatus, isVideoOff };
}
