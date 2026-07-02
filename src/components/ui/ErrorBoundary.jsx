import React from 'react';

function isChunkLoadError(error) {
  const msg = error?.message || '';
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to fetch') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script') ||
    error?.name === 'ChunkLoadError' ||
    error?.name === 'LoadingChunkError'
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isChunkError) {
        return (
          <div className="flex min-h-screen flex-col items-center justify-center bg-rdb-bg p-8 text-center">
            <div className="rdb-panel max-w-sm p-8">
              <div className="mb-4 text-3xl">⚡</div>
              <h1 className="mb-3 font-mono text-lg font-bold uppercase text-rdb-orange">UPDATE AVAILABLE</h1>
              <p className="mb-6 font-mono text-xs uppercase text-rdb-muted leading-relaxed">
                A new version was deployed. Reload to get the latest.
              </p>
              <button
                className="rdb-button rdb-button-primary w-full px-6 py-3 font-mono text-sm uppercase"
                onClick={() => window.location.reload()}
                type="button"
              >
                RELOAD NOW
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-rdb-bg p-8 text-center">
          <div className="rdb-panel max-w-sm p-8">
            <div className="mb-4 text-3xl">💥</div>
            <h1 className="mb-3 font-mono text-lg font-bold uppercase text-rdb-orange">SOMETHING BROKE</h1>
            <p className="mb-6 font-mono text-xs uppercase text-rdb-muted leading-relaxed">
              Unexpected error. Try reloading.
            </p>
            <button
              className="rdb-button rdb-button-primary w-full px-6 py-3 font-mono text-sm uppercase"
              onClick={() => window.location.reload()}
              type="button"
            >
              RELOAD
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
