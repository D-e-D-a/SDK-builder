/**
 * EmbedPage — the root component rendered inside the iframe.
 *
 * This is the reference implementation. Replace the JSX inside the
 * "widget content" section with your actual UI.
 *
 * The component:
 *   - Reads parentOrigin from the URL search params (set by the parent SDK)
 *   - Drives the protocol handshake → auth → ready lifecycle via useProtocol
 *   - Shows/hides based on WIDGET_OPEN / WIDGET_CLOSE signals
 */
import { useMemo } from 'react';
import { useProtocol } from './useProtocol.js';

export function EmbedPage() {
  // parentOrigin is injected by the parent SDK as a URL query param
  const parentOrigin = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get('parentOrigin');
    if (!p) console.warn('[Widget] parentOrigin not found in URL — postMessage will not work');
    return p ?? '';
  }, []);

  const { state, isOpen, pushEvent, requestResize } = useProtocol(parentOrigin);

  // ── Connection guard ─────────────────────────────────────────────────────

  if (!parentOrigin) {
    return (
      <div style={styles.errorBox}>
        <strong>[EmbedSDK Widget]</strong> Missing <code>parentOrigin</code> query param.
        <br />
        Load this page through the parent SDK — do not open it directly.
      </div>
    );
  }

  if (state === 'ERROR') {
    return (
      <div style={styles.errorBox}>
        <strong>[EmbedSDK Widget]</strong> Protocol error. Check the browser console.
      </div>
    );
  }

  // ── Widget UI ─────────────────────────────────────────────────────────────

  return (
    <div style={{ ...styles.root, ...(isOpen ? styles.open : styles.closed) }}>

      {/* ── Replace everything below with your widget UI ── */}

      <div style={styles.card}>

        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>Your Widget</span>
          <button
            style={styles.closeBtn}
            onClick={() => pushEvent('widget:close-requested', null)}
            aria-label="Close widget"
          >
            ×
          </button>
        </div>

        {/* Body — your content goes here */}
        <div style={styles.body}>
          <p style={styles.placeholder}>
            Replace this with your application UI.
          </p>
          <button
            style={styles.demoBtn}
            onClick={() => {
              pushEvent('demo:clicked', { ts: Date.now() });
              requestResize('420px', '560px');
            }}
          >
            Fire demo event
          </button>
        </div>

        {/* Dev status bar — remove in production */}
        {import.meta.env.DEV && (
          <div style={styles.devBar}>
            state: <strong>{state}</strong>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    position:   'fixed' as const,
    inset:      0,
    display:    'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding:    '1.5rem',
    transition: 'opacity 200ms ease, visibility 200ms ease',
  },
  open: {
    opacity:    1,
    visibility: 'visible' as const,
    pointerEvents: 'auto' as const,
  },
  closed: {
    opacity:    0,
    visibility: 'hidden' as const,
    pointerEvents: 'none' as const,
  },
  card: {
    width:        '360px',
    maxHeight:    '520px',
    background:   '#fff',
    borderRadius: '12px',
    boxShadow:    '0 8px 32px rgba(0,0,0,0.18)',
    display:      'flex',
    flexDirection: 'column' as const,
    overflow:     'hidden',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '1rem 1.25rem',
    borderBottom:   '1px solid #eee',
  },
  title: {
    fontWeight: 600,
    fontSize:   '0.95rem',
  },
  closeBtn: {
    background:  'none',
    border:      'none',
    cursor:      'pointer',
    fontSize:    '1.4rem',
    lineHeight:  1,
    color:       '#888',
    padding:     '0.1rem 0.3rem',
  },
  body: {
    flex:       1,
    padding:    '1.25rem',
    overflowY:  'auto' as const,
    display:    'flex',
    flexDirection: 'column' as const,
    gap:        '1rem',
  },
  placeholder: {
    color:      '#666',
    fontSize:   '0.9rem',
    lineHeight: 1.6,
  },
  demoBtn: {
    padding:      '0.6rem 1rem',
    background:   '#2563eb',
    color:        '#fff',
    border:       'none',
    borderRadius: '6px',
    cursor:       'pointer',
    fontSize:     '0.875rem',
    fontWeight:   500,
    alignSelf:    'flex-start' as const,
  },
  devBar: {
    padding:    '0.4rem 1.25rem',
    fontSize:   '0.75rem',
    background: '#f0f4ff',
    color:      '#555',
    borderTop:  '1px solid #e0e8ff',
  },
  errorBox: {
    padding:      '1rem',
    background:   '#fff3cd',
    border:       '1px solid #ffc107',
    borderRadius: '6px',
    margin:       '1rem',
    fontSize:     '0.85rem',
    lineHeight:   1.6,
  },
} as const;
