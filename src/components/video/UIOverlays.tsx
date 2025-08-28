import React from "react";
import { VolumeToast } from "./types";

interface VolumeToastComponentProps {
  volumeToast: VolumeToast;
}

export const VolumeToastComponent: React.FC<VolumeToastComponentProps> = ({
  volumeToast,
}) => {
  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-2 bg-black/80 px-4 py-2 rounded-lg transition-all duration-300 ${
        volumeToast.show
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-[-20px]"
      }`}
    >
      {volumeToast.value === 0 ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
          />
        </svg>
      ) : volumeToast.value < 50 ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM15 9.354a4 4 0 010 5.292"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
        </svg>
      )}
      <span className="text-white font-medium">
        Âm lượng: {volumeToast.value}%
      </span>
    </div>
  );
};

interface PoweredByBadgeProps {
  show: boolean;
}

export const PoweredByBadge: React.FC<PoweredByBadgeProps> = ({ show }) => {
  if (!show) return null;

  return (
    <div className="absolute bottom-3 right-3 z-50">
      <div className="bg-black/75 px-3 py-1.5 rounded-lg shadow-lg border border-blue-500/30 flex items-center">
        <span className="text-white text-sm font-medium mr-1">Powered by</span>
        <span className="text-gradient bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-cyan-500 font-bold text-sm">
          Jozo
        </span>
        <div className="h-2 w-2 rounded-full bg-blue-500 ml-1.5"></div>
      </div>
    </div>
  );
};

interface ConnectionStatusIndicatorProps {
  connected: boolean;
  connectionAttempts: number;
}

export const ConnectionStatusIndicator: React.FC<
  ConnectionStatusIndicatorProps
> = ({ connected, connectionAttempts }) => {
  if (connected || connectionAttempts === 0) return null;

  return (
    <div className="absolute top-4 left-4 z-50 bg-red-500 px-4 py-2 rounded-full">
      <p className="text-white text-sm">
        Đang kết nối lại... {connectionAttempts}
      </p>
    </div>
  );
};

interface NetworkStatusIndicatorProps {
  isOnline: boolean;
}

export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({
  isOnline,
}) => {
  if (isOnline) return null;

  return (
    <div className="absolute bottom-4 left-4 z-50 bg-yellow-500 px-4 py-2 rounded-full">
      <p className="text-white">Mất kết nối mạng!</p>
    </div>
  );
};
