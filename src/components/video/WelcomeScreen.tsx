import React from "react";
import { CUTE_MESSAGES } from "./constants";
import TrendingSongsList from "./TrendingSongsList";
import vietnamFlag from "../../assets/vietnam-741.gif";

interface WelcomeScreenProps {
  currentMessageIndex: number;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  currentMessageIndex,
}) => {
  return (
    <div className="absolute inset-0 z-[30] flex flex-col">
      {/* Background with Vietnam Flag - Full Screen */}
      <div className="absolute inset-0 w-full h-full">
        <img
          src={vietnamFlag}
          alt="Lá cờ Việt Nam"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Fixed cute message at top */}
        <div className="w-full px-4 py-2">
          <div className="px-4 py-2 rounded-xl bg-black/30 backdrop-blur-sm border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.3)]">
            <p className="text-lg font-bold text-center bg-gradient-to-r from-red-400 via-yellow-300 to-green-400 bg-clip-text text-transparent">
              {CUTE_MESSAGES[currentMessageIndex]}
            </p>
          </div>
        </div>

        {/* Song list without scrolling */}
        <div className="flex-1 px-2 py-2">
          <TrendingSongsList />
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
