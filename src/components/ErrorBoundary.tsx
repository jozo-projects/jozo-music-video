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
 * Giữ màn hình lỗi để nhân viên có thể xem và chủ động thử lại.
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {

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
  }

  private handleRetry = () => {
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
            Vui lòng thử lại hoặc liên hệ nhân viên.
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
