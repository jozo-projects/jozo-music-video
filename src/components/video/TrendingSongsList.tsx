import React from "react";
import { TRENDING_SONGS } from "./constants";

interface TrendingSong {
  title: string;
  artist: string;
  views: string;
  genre: string;
  category: "summer" | "school" | "vietnam";
  description: string;
}

interface TrendingSongsListProps {
  songs?: TrendingSong[];
}

const TrendingSongsList: React.FC<TrendingSongsListProps> = ({
  songs = TRENDING_SONGS,
}) => {
  // Filter only Vietnam songs
  const vietnamSongs = songs.filter((song) => song.category === "vietnam");

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Content Layer */}
      <div className="w-full h-full bg-black/50 backdrop-blur-md rounded-lg p-3 flex flex-col">
        {/* Header - Compact */}
        <div className="text-center mb-3 flex-shrink-0">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500/30 to-cyan-500/30 rounded-full border border-white/20 backdrop-blur-sm mb-2">
            <span className="text-blue-400 text-lg">🇻🇳</span>
            <h2 className="text-lg font-bold text-white">
              Nhạc chào mừng 80 năm Quốc Khánh 2/9
            </h2>
            <span className="text-blue-400 text-lg">🇻🇳</span>
          </div>
          <p className="text-white/90 text-sm">
            Những bài hát ca ngợi quê hương đất nước
          </p>
        </div>

        {/* Songs Grid - Compact */}
        <div className="flex-1 min-h-0">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 h-full">
            {vietnamSongs.map((song, index) => (
              <div
                key={index}
                className="group bg-white/15 backdrop-blur-lg rounded-lg p-2 border border-white/25 hover:bg-white/25 transition-all duration-200 hover:scale-105 cursor-pointer"
              >
                <div className="flex items-start gap-2">
                  {/* Song Number - Smaller */}
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gradient-to-br from-blue-500/90 to-cyan-500/90 rounded-full text-xs font-bold text-white border border-white/60 shadow-md group-hover:scale-110 transition-transform duration-200">
                    {index + 1}
                  </div>

                  {/* Song Info - Compact */}
                  <div className="flex-grow min-w-0">
                    <h3 className="text-xs font-bold text-white leading-tight mb-1 line-clamp-2 group-hover:text-cyan-200 transition-colors duration-200">
                      {song.title}
                    </h3>
                    <p className="text-white/90 text-[10px] leading-tight mb-1 font-medium">
                      {song.artist}
                    </p>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-gradient-to-r from-blue-500/70 to-cyan-500/70 text-white border border-white/40">
                        {song.genre}
                      </span>
                      <span className="text-white/80 text-[9px] flex items-center bg-white/10 px-1 py-0.5 rounded-full">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-2.5 w-2.5 mr-0.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                        {song.views}
                      </span>
                    </div>
                    <p className="text-white/70 text-[9px] italic leading-tight line-clamp-1 group-hover:text-white/90 transition-colors duration-200">
                      {song.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer - Compact */}
        <div className="mt-3 text-center flex-shrink-0">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500/50 to-cyan-500/50 rounded-full border border-white/40 backdrop-blur-lg shadow-lg">
            <span className="text-blue-400 text-lg">🇻🇳</span>
            <span className="text-white text-sm font-bold">
              Việt Nam - Đất nước tôi yêu!
            </span>
            <span className="text-blue-400 text-lg">🇻🇳</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrendingSongsList;
