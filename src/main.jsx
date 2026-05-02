import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Catches any React render error so a single bad chapter or stale localStorage
// blob doesn't leave the user staring at a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', background: '#FAF6F0', color: '#1A1612',
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, marginBottom: 12 }}>
            Something went wrong.
          </h1>
          <p style={{ fontSize: 17, color: '#8A7E73', marginBottom: 20 }}>
            The app hit an unexpected error. Refreshing usually helps. If it
            keeps happening, the link below clears your saved data — your
            subscriptions and inbox will reset.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#6B1D2A', color: '#FAF6F0', border: 'none', padding: '10px 22px', borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >Reload</button>
            <button
              onClick={() => { try { localStorage.clear(); } catch {} window.location.href = '/app'; }}
              style={{ background: 'transparent', color: '#1A1612', border: '1.5px solid #DDD5CA', padding: '10px 22px', borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >Reset & reload</button>
          </div>
          <pre style={{ marginTop: 20, fontFamily: 'monospace', fontSize: 11, color: '#B55', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
