import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { getDeviceId } from "@/utils/deviceId";
import { devError, devLog } from "@/utils/devLog";
import { SocketStatus, VideoTurnedOffData } from "../types";

// Tạo một global socket để tránh nhiều kết nối mới
type SocketInstance = ReturnType<typeof io>;
let globalSocket: SocketInstance | null = null;
let globalSocketRoomId: string | null = null;

interface UseSocketConnectionProps {
  roomId: string;
  onConnect: () => void;
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
  const [socket, setSocket] = useState<SocketInstance | null>(globalSocket);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>({
    connected: globalSocket?.connected || false,
    connectionAttempts: 0,
  });
  const connectingRef = useRef(false);
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
      return;
    }

    // Nếu đang kết nối, bỏ qua
    if (connectingRef.current) {
      return;
    }

    // Sử dụng socket toàn cục nếu đã tồn tại, kết nối, và cùng roomId
    if (
      globalSocket &&
      globalSocket.connected &&
      globalSocketRoomId === roomId
    ) {
      devLog("Sử dụng kết nối socket hiện có");
      setSocket((prev) => (prev === globalSocket ? prev : globalSocket));
      setSocketStatus((prev) => {
        if (prev.connected && prev.connectionAttempts === 0) return prev;
        return {
          connected: true,
          connectionAttempts: 0,
        };
      });

      globalSocket.emit("request_current_song", { roomId });

      return;
    }

    // Đánh dấu đang kết nối
    connectingRef.current = true;

    // Xóa socket cũ nếu không còn kết nối hoặc đổi roomId (query chỉ gửi lúc handshake)
    if (globalSocket) {
      globalSocket.disconnect();
      globalSocket = null;
      globalSocketRoomId = null;
    }

    devLog(
      `Kết nối tới socket server: ${
        import.meta.env.VITE_SOCKET_URL || "URL mặc định"
      }`
    );

    // Tạo kết nối socket mới
    const socketInstance = io(import.meta.env.VITE_SOCKET_URL || "", {
      query: {
        roomId,
        deviceId: getDeviceId(),
        clientType: "video",
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000, // Giảm timeout để kết nối nhanh hơn
      transports: ["websocket", "polling"],
      path: "/socket.io",
      forceNew: true,
    });

    // Lưu vào biến toàn cục
    globalSocket = socketInstance;
    globalSocketRoomId = roomId;
    setSocket(socketInstance);

    // Xử lý kết nối thành công
    socketInstance.on("connect", () => {
      devLog("Socket kết nối thành công");
      connectingRef.current = false;

      setSocketStatus((prev) => {
        if (prev.connected && prev.connectionAttempts === 0) return prev;
        return {
          connected: true,
          connectionAttempts: 0,
        };
      });

      socketInstance.emit("request_current_song", { roomId });
      onConnectRef.current();
    });

    // Xử lý lỗi kết nối
    socketInstance.on("connect_error", (error: Error) => {
      devError("Lỗi kết nối socket:", error.message);
      connectingRef.current = false;
    });

    // Xử lý ngắt kết nối
    socketInstance.on("disconnect", () => {
      devLog("Socket ngắt kết nối");
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
      }));
    });

    // Xử lý thử kết nối lại
    socketInstance.on("reconnect_attempt", (attemptNumber: number) => {
      devLog(`Thử kết nối lại #${attemptNumber}`);

      setSocketStatus((prev) => ({
        ...prev,
        connectionAttempts: attemptNumber,
      }));
    });

    // Xử lý kết nối lại thành công
    socketInstance.on("reconnect", () => {
      devLog("Socket kết nối lại thành công");
      connectingRef.current = false;

      setSocketStatus((prev) => ({
        ...prev,
        connected: true,
      }));

      socketInstance.emit("request_current_song", { roomId });
      onConnectRef.current();
    });

    // Xử lý videos_turned_off
    socketInstance.on("videos_turned_off", (data: VideoTurnedOffData) => {
      devLog("Videos đã bị tắt bởi backend", data);
      setIsVideoOff(true);
      onVideosOffRef.current();
    });

    // Xử lý videos_turned_on
    socketInstance.on("videos_turned_on", () => {
      devLog("Videos đã được bật bởi backend");
      setIsVideoOff(false);
      onVideosOnRef.current();
    });

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      if (socketInstance.connected) {
        socketInstance.emit("heartbeat", { roomId });
      }
    }, 60000);

    // Cleanup
    return () => {
      clearInterval(heartbeatInterval);

      // Giữ lại kết nối socket cho toàn bộ ứng dụng
      // Chỉ xóa các event listener để tránh memory leak
      if (socketInstance) {
        socketInstance.off("connect");
        socketInstance.off("connect_error");
        socketInstance.off("disconnect");
        socketInstance.off("reconnect_attempt");
        socketInstance.off("reconnect");
        socketInstance.off("videos_turned_off");
        socketInstance.off("videos_turned_on");
      }
    };
  }, [roomId]);

  return { socket, socketStatus, isVideoOff };
}
