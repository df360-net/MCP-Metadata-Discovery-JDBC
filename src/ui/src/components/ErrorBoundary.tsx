import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: 24, border: "1px solid #fca5a5", borderRadius: 8, background: "#fef2f2", margin: 16 }}>
          <h3 style={{ color: "#dc2626", margin: "0 0 8px" }}>Something went wrong</h3>
          <p style={{ color: "#7f1d1d", fontSize: 14, margin: 0 }}>{this.state.error?.message}</p>
          <button
            style={{ marginTop: 12, padding: "6px 16px", borderRadius: 4, border: "1px solid #dc2626", color: "#dc2626", background: "white", cursor: "pointer" }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
