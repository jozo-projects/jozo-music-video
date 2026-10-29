import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createHlsPlayback } from "./hlsPlayback";

interface HlsVideoProps {
  url: string;
  playbackKey?: string;
  volume?: number;
  /** Authoritative room intent, including paused hydration. Defaults to playing. */
  desiredPlaying?: boolean;
  /** Used only when starting a new URL/queue identity, never on ordinary renders. */
  initialPosition?: number;
  onLoadedData?: () => void;
  onEnded?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
}

const HlsVideo = forwardRef<HTMLVideoElement, HlsVideoProps>(
  ({ url, playbackKey, volume = 100, desiredPlaying, initialPosition, onLoadedData, onEnded, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playbackRef = useRef<ReturnType<typeof createHlsPlayback> | null>(null);
    const identity = JSON.stringify([url, playbackKey]);
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const callbacks = useRef({ onLoadedData, onEnded, onError });
    callbacks.current = { onLoadedData, onEnded, onError };
    const desiredRef = useRef(desiredPlaying);
    desiredRef.current = desiredPlaying;
    const initialPositionRef = useRef(initialPosition);
    initialPositionRef.current = initialPosition;
    const [retryIdentity, setRetryIdentity] = useState<string | null>(null);
    const [loadingIdentity, setLoadingIdentity] = useState<string | null>(identity);

    // Expose the real element to the parent's remote playback/seek controls.
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !url) return;
      setRetryIdentity(null);
      const playback = createHlsPlayback({
        video, url,
        desiredPlaying: desiredRef.current,
        initialPosition: initialPositionRef.current,
        isCurrent: () => currentIdentity.current === identity,
        onReady: () => callbacks.current.onLoadedData?.(),
        onEnded: () => callbacks.current.onEnded?.(),
        onUnsupported: () => callbacks.current.onError?.(
          new Event("error") as unknown as React.SyntheticEvent<HTMLVideoElement, Event>
        ),
        onRetryVisible: (visible) => setRetryIdentity(visible ? identity : null),
        onLoadingChange: (loading) => setLoadingIdentity(loading ? identity : null),
      });
      playbackRef.current = playback;
      return () => {
        playback.dispose();
        if (playbackRef.current === playback) playbackRef.current = null;
      };
    }, [url, identity]);

    useEffect(() => {
      playbackRef.current?.setPendingPosition(initialPosition);
    }, [initialPosition, identity]);

    useEffect(() => {
      playbackRef.current?.setDesiredPlaying(desiredPlaying);
    }, [desiredPlaying, identity]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      video.volume = Math.min(1, Math.max(0, volume / 100));
      video.muted = volume === 0;
    }, [volume, identity]);

    if (!url) return null;

    return (
      <>
        <video
          key={identity}
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          controls={false}
          disablePictureInPicture
          controlsList="nodownload noplaybackrate nofullscreen"
          preload="auto"
          muted={volume === 0}
          style={{ objectFit: "contain", width: "100%", height: "100%", backgroundColor: "#000" }}
        />
        {loadingIdentity === identity && retryIdentity !== identity && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/50 text-xl text-white" role="status" aria-live="polite">
            Đang tải video…
          </div>
        )}
        {retryIdentity === identity && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70" role="alert">
            <button
              type="button"
              autoFocus
              className="rounded-lg border-2 border-white bg-black px-6 py-4 text-xl text-white focus:outline focus:outline-4 focus:outline-yellow-400"
              onClick={() => {
                if (currentIdentity.current === identity) playbackRef.current?.retry();
              }}
            >
              Không thể phát video. Thử lại
            </button>
          </div>
        )}
      </>
    );
  }
);

HlsVideo.displayName = "HlsVideo";
export default memo(HlsVideo);
