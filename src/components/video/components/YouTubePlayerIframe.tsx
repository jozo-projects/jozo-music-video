/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef } from "react";

interface YouTubePlayerIframeProps {
  playerRef: React.MutableRefObject<any>;
  videoId: string | undefined;
  onReady: (event: any) => void;
  onStateChange: (event: any) => void;
  onError: (event: any) => void;
  onPlaybackQualityChange: (event: any) => void;
  isFallback: boolean;
  fallbackVideoId: string;
  showControls?: boolean;
}

const YouTubePlayerIframe: React.FC<YouTubePlayerIframeProps> = ({
  playerRef,
  videoId,
  onReady,
  onStateChange,
  onError,
  onPlaybackQualityChange,
  isFallback,
  fallbackVideoId,
  showControls = false,
}) => {
  const playerDivRef = useRef<HTMLDivElement>(null);
  const playerCreatedRef = useRef(false);

  useEffect(() => {
    // YouTube IFrame API needs to be loaded first by the parent component
    if (!(window as any).YT || !(window as any).YT.Player) {
      console.warn("YouTube API not loaded");
      return;
    }

    // Only create the player once
    if (!playerCreatedRef.current && playerDivRef.current) {
      try {
        const actualVideoId = isFallback ? fallbackVideoId : videoId;
        if (!actualVideoId) {
          console.warn("No video ID provided");
          return;
        }

        const player = new (window as any).YT.Player(playerDivRef.current, {
          videoId: actualVideoId,
          playerVars: {
            autoplay: 1,
            controls: showControls ? 1 : 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            autohide: 1,
            cc_load_policy: 0,
            cc_lang_pref: "none",
            hl: "vi",
          },
          events: {
            onReady: (event: any) => {
              if (playerRef.current !== player) {
                playerRef.current = player;
              }
              console.log("YouTube player ready - should hide loading");
              try {
                if (
                  event.target &&
                  typeof event.target.unloadModule === "function"
                ) {
                  event.target.unloadModule("captions");
                }
                if (
                  event.target &&
                  typeof event.target.setOption === "function"
                ) {
                  event.target.setOption("captions", "track", {});
                  event.target.setOption("captions", "reload", false);
                  event.target.setOption("captions", "track", {
                    languageCode: "",
                  });
                }
              } catch (e) {
                console.error("Error disabling captions:", e);
              }
              onReady(event);
            },
            onStateChange,
            onError,
            onPlaybackQualityChange,
          },
        });

        playerCreatedRef.current = true;
      } catch (error) {
        console.error("Error creating YouTube player:", error);
      }
    }

    const updateVideoId = () => {
      const actualVideoId = isFallback ? fallbackVideoId : videoId;
      if (playerRef.current && actualVideoId) {
        try {
          if (playerRef.current.getVideoData) {
            const currentVideoId = playerRef.current.getVideoData().video_id;
            if (currentVideoId !== actualVideoId) {
              playerRef.current.loadVideoById({
                videoId: actualVideoId,
                startSeconds: 0,
                ...(isFallback ? { suggestedQuality: "small" as const } : {}),
              });
              try {
                if (playerRef.current.setOption) {
                  playerRef.current.setOption("captions", "track", {});
                  playerRef.current.setOption("captions", "reload", false);
                  playerRef.current.setOption("captions", "track", {
                    languageCode: "",
                  });
                }
              } catch (e) {
                console.error(
                  "Error disabling captions after video change:",
                  e
                );
              }
            }
          } else {
            playerRef.current.loadVideoById({
              videoId: actualVideoId,
              startSeconds: 0,
              ...(isFallback ? { suggestedQuality: "small" as const } : {}),
            });
          }
        } catch (e) {
          console.error("Error updating video ID:", e);
        }
      }
    };

    if (playerCreatedRef.current) {
      updateVideoId();
    }
  }, [
    videoId,
    onReady,
    onStateChange,
    onError,
    onPlaybackQualityChange,
    playerRef,
    isFallback,
    fallbackVideoId,
    showControls,
  ]);

  return <div id="youtube-player" ref={playerDivRef} />;
};

export default YouTubePlayerIframe;
