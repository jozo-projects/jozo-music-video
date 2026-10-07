import Hls from "hls.js";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import { isHlsUrl } from "../../utils/hls";

interface HlsVideoProps {
  url: string;
  playbackKey?: string;
  volume?: number;
  onLoadedData?: () => void;
  onEnded?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
}

const HlsVideo = forwardRef<HTMLVideoElement, HlsVideoProps>(
  ({ url, playbackKey, volume = 100, onLoadedData, onEnded, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const loadedUrlRef = useRef("");
    const readyNotifiedRef = useRef(false);
    const onLoadedDataRef = useRef(onLoadedData);
    const onErrorRef = useRef(onError);
    const onEndedRef = useRef(onEnded);
    const endedNotifiedRef = useRef(false);
    const acceptEndedRef = useRef(true);
    onLoadedDataRef.current = onLoadedData;
    onErrorRef.current = onError;
    onEndedRef.current = onEnded;

    const notifyEnded = () => {
      const video = videoRef.current;
      if (!acceptEndedRef.current || !video || endedNotifiedRef.current) return;
      const duration = video.duration;
      const atEnd =
        video.ended ||
        (Number.isFinite(duration) &&
          duration > 0 &&
          video.currentTime >= duration - 0.75);
      if (!atEnd) return;
      endedNotifiedRef.current = true;
      onEndedRef.current?.();
    };

    // Expose the actual HTMLVideoElement so parent playback handlers never
    // fall through to the hidden YouTube iframe.
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    const notifyReadyOnce = () => {
      if (readyNotifiedRef.current) return;
      readyNotifiedRef.current = true;
      onLoadedDataRef.current?.();
    };

    useEffect(() => {
      readyNotifiedRef.current = false;
    }, [url]);

    // Each queue entry may reuse the mounted HLS element and URL, but must be
    // allowed to emit its own ended event.
    useEffect(() => {
      endedNotifiedRef.current = false;
    }, [url, playbackKey]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !url) return;
      acceptEndedRef.current = true;

      // Đã attach đúng URL — không destroy + load lại.
      if (hlsRef.current && loadedUrlRef.current === url) {
        return;
      }

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      loadedUrlRef.current = url;

      if (isHlsUrl(url)) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            notifyReadyOnce();
            video.play().catch((err) => {
              console.warn("HLS autoplay blocked:", err);
            });
          });
          hls.on(Hls.Events.MEDIA_ENDED, () => {
            notifyEnded();
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              console.error("HLS fatal error:", data);
              onErrorRef.current?.(
                new Event("error") as unknown as React.SyntheticEvent<HTMLVideoElement, Event>
              );
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = url;
        } else {
          console.error("HLS is not supported in this browser");
        }
      } else {
        video.src = url;
      }

      const handleNativeEnded = () => notifyEnded();
      video.addEventListener("ended", handleNativeEnded);

      return () => {
        acceptEndedRef.current = false;
        video.removeEventListener("ended", handleNativeEnded);
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        loadedUrlRef.current = "";
      };
    }, [url]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      video.volume = volume / 100;
      video.muted = volume === 0;
    }, [volume]);

    if (!url) return null;

    return (
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        autoPlay
        playsInline
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate nofullscreen"
        onLoadedData={isHlsUrl(url) && Hls.isSupported() ? undefined : notifyReadyOnce}
        onEnded={notifyEnded}
        onError={onError}
        preload="auto"
        muted={volume === 0}
        style={{
          objectFit: "contain",
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
        }}
      />
    );
  }
);

HlsVideo.displayName = "HlsVideo";

export default memo(HlsVideo);
