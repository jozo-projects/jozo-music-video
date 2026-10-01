import React, { useEffect } from "react";

const ROOM_IDS = Array.from({ length: 12 }, (_, i) => i + 1);

interface RoomSelectModalProps {
  open: boolean;
  currentRoomId: string;
  onSelect: (roomId: number) => void;
  onClose: () => void;
}

const RoomSelectModal: React.FC<RoomSelectModalProps> = ({
  open,
  currentRoomId,
  onSelect,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const selected = Number(currentRoomId);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-blue-500/30 bg-black/90 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-select-title"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="room-select-title"
            className="text-lg font-bold text-white tracking-wide"
          >
            Chọn phòng
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {ROOM_IDS.map((id) => {
            const isActive = selected === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className={`aspect-square rounded-lg border text-lg font-semibold transition-colors ${
                  isActive
                    ? "border-blue-400 bg-blue-500/30 text-white"
                    : "border-white/20 bg-white/5 text-white/90 hover:border-blue-400/60 hover:bg-blue-500/15"
                }`}
              >
                {id}
              </button>
            );
          })}
        </div>

        {currentRoomId ? (
          <p className="mt-4 text-center text-sm text-white/50">
            Phòng hiện tại: {currentRoomId}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default RoomSelectModal;
