import React from "react";

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any) {
    console.error("App crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: "white" }}>
          Player crashed. Refresh the page (and check console).
        </div>
      );
    }
    return this.props.children;
  }
}