import { useEffect, useState, useRef } from "react";
import io, { Socket } from "socket.io-client";
import { SocketStatus, VideoTurnedOffData } from "../types";

// Tạo một global socket để tránh nhiều kết nối mới
let globalSocket: Socket | null = null;

interface UseSocketConnectionProps {
  roomId: string;
  onConnect: () => void;
  onVideosOff: () => void;
  onVideosOn: () => void;
}

interface UseSocketConnectionResult {
  socket: Socket | null;
  socketStatus: SocketStatus;
  isVideoOff: boolean;
}

export function useSocketConnection({
  roomId,
  onConnect,
  onVideosOff,
  onVideosOn,
}: UseSocketConnectionProps): UseSocketConnectionResult {
  const [socket, setSocket] = useState<Socket | null>(globalSocket);
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
    // Nếu đang kết nối, bỏ qua
    if (connectingRef.current) {
      return;
    }

    // Sử dụng socket toàn cục nếu đã tồn tại và kết nối
    if (globalSocket && globalSocket.connected) {
      console.log("Sử dụng kết nối socket hiện có");
      setSocket((prev) => (prev === globalSocket ? prev : globalSocket));
      setSocketStatus((prev) => {
        if (prev.connected && prev.connectionAttempts === 0) return prev;
        return {
          connected: true,
          connectionAttempts: 0,
        };
      });

      // Gửi roomId
      if (roomId) {
        globalSocket.emit("request_current_song", { roomId });
      }

      return;
    }

    // Đánh dấu đang kết nối
    connectingRef.current = true;

    // Xóa socket cũ nếu không còn kết nối
    if (globalSocket && !globalSocket.connected) {
      globalSocket.disconnect();
      globalSocket = null;
    }

    console.log(
      `Kết nối tới socket server: ${
        import.meta.env.VITE_SOCKET_URL || "URL mặc định"
      }`
    );

    // Tạo kết nối socket mới
    const socketInstance = io(import.meta.env.VITE_SOCKET_URL || "", {
      query: { roomId },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000, // Giảm timeout để kết nối nhanh hơn
      transports: ["websocket", "polling"],
      path: "/socket.io",
      forceNew: !globalSocket,
    });

    // Lưu vào biến toàn cục
    globalSocket = socketInstance;
    setSocket(socketInstance);

    // Xử lý kết nối thành công
    socketInstance.on("connect", () => {
      console.log("Socket kết nối thành công");
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
      console.error("Lỗi kết nối socket:", error.message);
      connectingRef.current = false;
    });

    // Xử lý ngắt kết nối
    socketInstance.on("disconnect", () => {
      console.log("Socket ngắt kết nối");
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
      }));
    });

    // Xử lý thử kết nối lại
    socketInstance.on("reconnect_attempt", (attemptNumber: number) => {
      console.log(`Thử kết nối lại #${attemptNumber}`);

      setSocketStatus((prev) => ({
        ...prev,
        connectionAttempts: attemptNumber,
      }));
    });

    // Xử lý kết nối lại thành công
    socketInstance.on("reconnect", () => {
      console.log("Socket kết nối lại thành công");
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
      console.log("Videos đã bị tắt bởi backend", data);
      setIsVideoOff(true);
      onVideosOffRef.current();
    });

    // Xử lý videos_turned_on
    socketInstance.on("videos_turned_on", () => {
      console.log("Videos đã được bật bởi backend");
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
