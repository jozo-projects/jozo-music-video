import React from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import VideoPlayer from "./components/video/VideoPlayer";

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <VideoPlayer />
    </ErrorBoundary>
  );
};

export default App;
