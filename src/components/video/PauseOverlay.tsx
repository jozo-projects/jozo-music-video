import React from "react";
import { logo } from "../../assets";
import { NowPlayingData } from "./types";

interface PauseOverlayProps {
  nowPlayingData: NowPlayingData;
}

const PauseOverlay: React.FC<PauseOverlayProps> = ({ nowPlayingData }) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-[30]">
      <div className="flex flex-col items-center p-8 rounded-lg bg-black/60 shadow-2xl">
        <img
          src={logo}
          alt="logo"
          className="w-40 h-40 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.7)]"
        />
        <p className="text-white mt-6 text-2xl font-bold tracking-wider text-shadow">
          {nowPlayingData.title}
        </p>
        <p className="text-white/70 mt-2 text-lg">Đang tạm dừng</p>
      </div>
    </div>
  );
};

export default PauseOverlay;
