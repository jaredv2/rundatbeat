import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-rdb-bg p-8 text-center">
          <h1 className="mb-4 font-mono text-2xl font-bold text-rdb-orange">SOMETHING WENT WRONG</h1>
          <p className="mb-6 max-w-md font-mono text-sm text-rdb-muted">
            An unexpected error occurred. Please reload the page.
          </p>
          <button
            className="rdb-button rdb-button-primary px-6 py-3 font-mono text-sm uppercase"
            onClick={() => window.location.reload()}
            type="button"
          >
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
