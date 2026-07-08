import React from "react";
import welcomeBackground from "../../assets/member-poster-final.png";

const WelcomeScreen: React.FC = () => {
  return (
    <div className="absolute inset-0 z-[30] flex flex-col bg-black overflow-hidden">
      {/* Nền blur scale — kiểu YouTube/Facebook letterbox */}
      <div className="absolute inset-0 scale-110" aria-hidden>
        <img
          src={welcomeBackground}
          alt=""
          className="h-full w-full object-cover blur-2xl brightness-75"
        />
      </div>

      {/* Poster chính sắc nét, giữ tỉ lệ */}
      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={welcomeBackground}
          alt="Đăng ký thành viên Jozo"
          className="max-h-full max-w-full object-contain drop-shadow-2xl"
        />
      </div>
    </div>
  );
};

export default WelcomeScreen;
