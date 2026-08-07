import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Application error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-fallback-screen">
        <section className="glass-panel app-fallback-card">
          <AlertTriangle size={38} style={{ color: 'var(--warning-primary)' }} />
          <div>
            <h1 className="serif-title">Easy Gold Ledger</h1>
            <p>Something went wrong while loading this screen.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={18} />
            Reload App
          </button>
        </section>
      </main>
    );
  }
}
