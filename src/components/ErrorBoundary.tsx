import React from "react";
import { logo } from "../assets";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorKey: number;
}

/**
 * Chống trắng màn: bắt mọi lỗi render trong subtree (như null deref, iframe
 * postMessage throw, YouTube API lỗi bất thường…) và cho user tự retry
 * thay vì buộc phải F5 toàn trang.
 *
 * Auto reload sau 5s nếu user không click retry — app này chạy trên tv-box
 * không có user tương tác liên tục, cần tự hồi phục.
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  private autoReloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorKey: 0 };
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Render crash:", error, info);
    }
    this.scheduleAutoReload();
  }

  componentWillUnmount() {
    this.clearAutoReload();
  }

  private scheduleAutoReload() {
    this.clearAutoReload();
    this.autoReloadTimer = setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  private clearAutoReload() {
    if (this.autoReloadTimer) {
      clearTimeout(this.autoReloadTimer);
      this.autoReloadTimer = null;
    }
  }

  private handleRetry = () => {
    this.clearAutoReload();
    this.setState((prev) => ({
      hasError: false,
      errorKey: prev.errorKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-black">
          <img
            src={logo}
            alt="logo"
            className="w-24 h-24 object-contain mb-6"
          />
          <p className="text-white text-xl mb-2">Có lỗi xảy ra</p>
          <p className="text-white/60 text-sm mb-6">
            Đang tự động tải lại sau 5 giây...
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="px-6 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
          >
            Thử lại ngay
          </button>
        </div>
      );
    }

    return (
      <React.Fragment key={this.state.errorKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export default ErrorBoundary;
