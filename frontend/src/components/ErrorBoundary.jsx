/**
 * ErrorBoundary — the app's last line of defence
 * ────────────────────────────────────────────────────────────────
 * Without this, a single render-time throw anywhere in the tree unmounts the whole
 * app and leaves a blank white window: no message, no way back, and — on a client's
 * PC — nothing to tell us what happened. The vendor's only option is to force-quit,
 * and their first assumption is that their day's sales are gone.
 *
 * Three deliberate constraints:
 *
 *  1. **No i18n.** This component cannot call useTranslation(): it is a class (needed
 *     for componentDidCatch), and more importantly the thing that just crashed may
 *     BE the language provider. So both languages are written out literally. A
 *     Marathi-speaking vendor must be able to read this even in the worst case.
 *  2. **No stylesheet dependency.** Everything is inline. If the crash happened
 *     before or during CSS-dependent setup, class names buy us nothing.
 *  3. **The report is sent, not just shown.** The renderer cannot write to disk
 *     (contextIsolation is on), so the stack is POSTed to the backend, which mirrors
 *     it into %APPDATA%/VyapaarSetu/logs/backend.log. That file is the only reason a
 *     support call about a white screen is answerable at all.
 *
 * Reload rather than "try again": re-rendering the same broken state usually throws
 * straight back, and a full reload is what a vendor would do anyway.
 */

import { Component } from 'react';

// Matches apiService.js: "" in the packaged build (relative to the app's own
// origin), the dev server's URL under `npm run dev`. Read via ?? so an explicit
// empty value is honoured instead of falling back.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ componentStack: info?.componentStack ?? null });

    // Fire-and-forget. The message below must appear whether or not this lands, so
    // failures here are swallowed on purpose — there is nowhere better to put them.
    try {
      fetch(`${API_BASE}/api/client-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: String(error?.message ?? error),
          stack: error?.stack ?? null,
          componentStack: info?.componentStack ?? null,
          route: window.location?.hash || window.location?.pathname || null,
        }),
      }).catch(() => {});
    } catch {
      /* offline, server down, or fetch unavailable — the UI still renders */
    }
  }

  details() {
    const { error, componentStack } = this.state;
    return [
      `VyapaarSetu error report`,
      `time: ${new Date().toISOString()}`,
      `route: ${window.location?.hash || window.location?.pathname || '-'}`,
      ``,
      `message: ${String(error?.message ?? error)}`,
      ``,
      error?.stack ?? '(no stack)',
      ``,
      componentStack ? `component stack:${componentStack}` : '',
    ].join('\n');
  }

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
    } catch {
      // Clipboard blocked. The text is on screen below, so it can still be
      // selected by hand — no silent dead end.
      this.setState({ copied: false });
    }
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, copied } = this.state;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f8fafc',
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            maxWidth: 660,
            width: '100%',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '28px 32px',
            boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
          }}
        >
          <div style={{ fontSize: '2rem', lineHeight: 1, marginBottom: 12 }}>⚠️</div>

          <h1 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 4px' }}>
            अ‍ॅपमध्ये अडचण आली
          </h1>
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              margin: '0 0 16px',
              color: '#475569',
            }}
          >
            Something went wrong
          </h2>

          {/* The vendor's first fear is their data. Answer it before anything else —
              and it is true: a render crash never reaches the database. */}
          <p
            style={{
              margin: '0 0 6px',
              fontWeight: 600,
              color: '#15803d',
              fontSize: '0.95rem',
            }}
          >
            तुमची माहिती सुरक्षित आहे. — Your data is safe.
          </p>
          <p style={{ margin: '0 0 20px', color: '#475569', fontSize: '0.9rem' }}>
            कृपया अ‍ॅप पुन्हा सुरू करा. अडचण राहिल्यास खालील तपशील कॉपी करून पाठवा.
            <br />
            Please reload the app. If the problem continues, copy the details below and
            send them to us.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <button
              onClick={this.reload}
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                border: 'none',
                background: '#15803d',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              पुन्हा सुरू करा / Reload
            </button>
            <button
              onClick={this.copy}
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                border: '1.5px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ कॉपी झाले / Copied' : 'तपशील कॉपी करा / Copy details'}
            </button>
          </div>

          <details>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#64748b',
              }}
            >
              तांत्रिक तपशील / Technical details
            </summary>
            <pre
              style={{
                marginTop: 10,
                padding: 12,
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                fontSize: '0.75rem',
                lineHeight: 1.5,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#334155',
              }}
            >
              {String(error?.message ?? error)}
              {error?.stack ? `\n\n${error.stack}` : ''}
              {this.state.componentStack ?? ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
