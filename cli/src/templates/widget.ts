import type { Config } from '../types.js';

export function generateWidget(c: Config): Record<string, string> {
  const protocolPkg = `${c.scope}/protocol`;

  return {
    // ── package manifest ──────────────────────────────────────────────────────
    'apps/widget/package.json': JSON.stringify(
      {
        name: `${c.scope}/widget`,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc --noEmit && vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          [protocolPkg]: 'workspace:*',
          react: '^18.3.0',
          'react-dom': '^18.3.0',
        },
        devDependencies: {
          '@types/node': '^20.14.0',
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          '@vitejs/plugin-react': '^4.3.0',
          typescript: '^5.5.0',
          vite: '^5.3.0',
        },
      },
      null,
      2
    ),

    'apps/widget/tsconfig.json': JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          noEmit: true,
          paths: { [protocolPkg]: ['../../packages/protocol/src/index.ts'] },
        },
        include: ['src'],
      },
      null,
      2
    ),

    // ── vite.config.ts ────────────────────────────────────────────────────────
    'apps/widget/vite.config.ts': `\
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    __WIDGET_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  build: {
    rollupOptions: {
      input: {
        embed: resolve(__dirname, 'embed.html'),
        main:  resolve(__dirname, 'index.html'),
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: [
      {
        find: '${protocolPkg}',
        replacement: resolve(__dirname, '../../packages/protocol/src/index.ts'),
      },
    ],
  },
  server: {
    port: 5174,
    cors: true,
    headers: { 'X-Frame-Options': 'ALLOWALL' },
  },
});
`,

    // ── HTML entry points ─────────────────────────────────────────────────────
    'apps/widget/embed.html': `\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${c.name} Widget</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root { height: 100%; }
      body { background: transparent; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/embed/main.tsx"></script>
  </body>
</html>
`,

    'apps/widget/index.html': `\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${c.name} — Dev Sandbox</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 2rem; background: #f5f5f5; }
      h1 { margin-bottom: 1rem; }
      p  { color: #555; line-height: 1.6; }
      code { background: #e0e0e0; padding: 0.1em 0.4em; border-radius: 3px; }
    </style>
  </head>
  <body>
    <h1>${c.name} Widget</h1>
    <p>The widget iframe is at <code>/embed</code>.</p>
    <p>Point your parent SDK's <code>widgetUrl</code> to <code>http://localhost:5174/embed</code>.</p>
  </body>
</html>
`,

    // ── src/vite-env.d.ts ─────────────────────────────────────────────────────
    'apps/widget/src/vite-env.d.ts': `\
/// <reference types="vite/client" />
declare const __WIDGET_VERSION__: string;
`,

    // ── src/embed/transport.ts ────────────────────────────────────────────────
    'apps/widget/src/embed/transport.ts': `\
import { parseEnvelope } from '${protocolPkg}';
import type { Envelope } from '${protocolPkg}';

export type MessageHandler = (env: Envelope) => void;

export class WidgetTransport {
  private readonly _parentOrigin: string;
  private _handlers: MessageHandler[] = [];
  private _seen = new Map<string, number>();
  private readonly _bound: (e: MessageEvent) => void;

  constructor(parentOrigin: string) {
    this._parentOrigin = parentOrigin;
    this._bound = (e: MessageEvent) => this._onMessage(e);
    window.addEventListener('message', this._bound);
  }

  send(env: Envelope): void {
    if (window.parent === window) return;
    window.parent.postMessage(env, this._parentOrigin);
  }

  onMessage(handler: MessageHandler): () => void {
    this._handlers.push(handler);
    return () => { this._handlers = this._handlers.filter(h => h !== handler); };
  }

  destroy(): void {
    window.removeEventListener('message', this._bound);
    this._handlers = [];
  }

  private _onMessage(e: MessageEvent): void {
    if (e.origin !== this._parentOrigin) return;
    const env = parseEnvelope(e.data);
    if (!env) return;

    if (this._seen.has(env.id)) return;
    this._seen.set(env.id, Date.now());
    if (this._seen.size > 200) {
      const cutoff = Date.now() - 60_000;
      for (const [id, ts] of this._seen) {
        if (ts < cutoff) this._seen.delete(id);
      }
    }

    for (const h of this._handlers) {
      try { h(env); }
      catch (err) { console.error('[Widget] Message handler threw:', err); }
    }
  }
}
`,

    // ── src/embed/useProtocol.ts ──────────────────────────────────────────────
    'apps/widget/src/embed/useProtocol.ts': `\
import { useEffect, useRef, useState, useCallback } from 'react';
import { createEnvelope, parsePayload, PROTOCOL_VERSION } from '${protocolPkg}';
import type { HandshakeInitPayload, AuthRequestPayload, RequestRectPayload, WidgetResizePayload } from '${protocolPkg}';
import { WidgetTransport } from './transport.js';

export type WidgetState = 'CONNECTING' | 'HANDSHAKING' | 'AUTHENTICATING' | 'READY' | 'ERROR';

export interface UseProtocolResult {
  state: WidgetState;
  isOpen: boolean;
  pushEvent: (event: string, data?: unknown) => void;
  requestResize: (width?: string, height?: string, styles?: Record<string, string>) => void;
}

/**
 * Validates the incoming auth token.
 * TODO: replace with your real backend validation logic.
 */
async function validateToken(
  payload: AuthRequestPayload
): Promise<{ userId?: string; sessionId?: string }> {
  // Reference implementation — accept any non-empty token.
  // Replace this with: const res = await fetch('/api/validate', { method: 'POST', body: JSON.stringify(payload) });
  return {
    userId:    payload.userId ?? 'anonymous',
    sessionId: \`session-\${Date.now().toString(36)}\`,
  };
}

export function useProtocol(parentOrigin: string): UseProtocolResult {
  const [state,  setState]  = useState<WidgetState>('CONNECTING');
  const [isOpen, setIsOpen] = useState(false);
  const transportRef = useRef<WidgetTransport | null>(null);

  const pushEvent = useCallback((event: string, data?: unknown) => {
    transportRef.current?.send(createEnvelope('PUSH_EVENT', { event, data }));
  }, []);

  const requestResize = useCallback(
    (width?: string, height?: string, styles?: Record<string, string>) => {
      transportRef.current?.send(createEnvelope('WIDGET_RESIZE', {
        ...(width   !== undefined && { width }),
        ...(height  !== undefined && { height }),
        ...(styles  !== undefined && { styles }),
      }));
    },
    []
  );

  useEffect(() => {
    if (!parentOrigin) return;

    const transport = new WidgetTransport(parentOrigin);
    transportRef.current = transport;

    const unsub = transport.onMessage(env => {
      switch (env.type) {
        case 'HANDSHAKE_INIT': {
          const p = parsePayload('HANDSHAKE_INIT', env.payload) as HandshakeInitPayload | null;
          if (!p) return;
          setState('HANDSHAKING');
          transport.send(createEnvelope('HANDSHAKE_ACK', {
            widgetVersion:     __WIDGET_VERSION__,
            negotiatedVersion: PROTOCOL_VERSION,
            capabilities:      ['auth', 'resize', 'push-event'],
            instanceId:        \`widget-\${Date.now().toString(36)}\`,
          }));
          break;
        }
        case 'AUTH_REQUEST': {
          const p = parsePayload('AUTH_REQUEST', env.payload) as AuthRequestPayload | null;
          if (!p) return;
          setState('AUTHENTICATING');
          validateToken(p)
            .then(result => {
              transport.send(createEnvelope('AUTH_SUCCESS', result));
              setState('READY');
            })
            .catch((err: unknown) => {
              const reason = err instanceof Error ? err.message : 'Auth failed';
              transport.send(createEnvelope('AUTH_FAIL', { reason, code: 'AUTH_FAILED' }));
              setState('ERROR');
            });
          break;
        }
        case 'WIDGET_OPEN':  setIsOpen(true);  break;
        case 'WIDGET_CLOSE': setIsOpen(false); break;
        case 'WIDGET_RESIZE': {
          const p = parsePayload('WIDGET_RESIZE', env.payload) as WidgetResizePayload | null;
          if (p?.height) document.documentElement.style.height = p.height;
          if (p?.width)  document.documentElement.style.width  = p.width;
          break;
        }
        case 'REQUEST_RECT': {
          const p = parsePayload('REQUEST_RECT', env.payload) as RequestRectPayload | null;
          if (!p) return;
          const r = document.documentElement.getBoundingClientRect();
          transport.send(createEnvelope('RECT_RESPONSE', {
            correlationId: p.correlationId,
            rect: { x: r.left, y: r.top, width: r.width, height: r.height },
          }));
          break;
        }
        case 'HEARTBEAT_PING':
          transport.send(createEnvelope('HEARTBEAT_PONG', {}));
          break;
        case 'SDK_DESTROY':
          transport.destroy();
          transportRef.current = null;
          setState('CONNECTING');
          setIsOpen(false);
          break;
      }
    });

    transport.send(createEnvelope('WIDGET_READY', {}));

    return () => {
      unsub();
      transport.destroy();
      transportRef.current = null;
    };
  }, [parentOrigin]);

  return { state, isOpen, pushEvent, requestResize };
}
`,

    // ── src/embed/EmbedPage.tsx ───────────────────────────────────────────────
    'apps/widget/src/embed/EmbedPage.tsx': `\
import { useMemo } from 'react';
import { useProtocol } from './useProtocol.js';

export function EmbedPage() {
  const parentOrigin = useMemo(() => {
    return new URLSearchParams(window.location.search).get('parentOrigin') ?? '';
  }, []);

  const { state, isOpen, pushEvent } = useProtocol(parentOrigin);

  if (!parentOrigin) {
    return (
      <div style={{ padding: '1rem', background: '#fff3cd', borderRadius: '6px', margin: '1rem' }}>
        <strong>[${c.name}]</strong> Missing <code>parentOrigin</code> query param.
        Load this page through the parent SDK.
      </div>
    );
  }

  if (state === 'ERROR') {
    return (
      <div style={{ padding: '1rem', background: '#f8d7da', borderRadius: '6px', margin: '1rem' }}>
        <strong>[${c.name}]</strong> Protocol error. Check the browser console.
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
      padding: '1.5rem',
      opacity: isOpen ? 1 : 0,
      visibility: isOpen ? 'visible' : 'hidden',
      transition: 'opacity 200ms ease, visibility 200ms ease',
    }}>
      <div style={{
        width: '360px', background: '#fff', borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>${c.name}</span>
          <button
            onClick={() => pushEvent('widget:close-requested', null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: '#888' }}
            aria-label="Close"
          >×</button>
        </div>

        {/* Body — replace with your widget UI */}
        <div style={{ padding: '1.25rem', minHeight: '200px' }}>
          <p style={{ color: '#666', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Replace this with your widget UI.
          </p>
          <button
            onClick={() => pushEvent('demo:clicked', { ts: Date.now() })}
            style={{ marginTop: '1rem', padding: '0.6rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Fire demo event
          </button>
        </div>

        {import.meta.env.DEV && (
          <div style={{ padding: '0.4rem 1.25rem', fontSize: '0.75rem', background: '#f0f4ff', color: '#555', borderTop: '1px solid #e0e8ff' }}>
            state: <strong>{state}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
`,

    // ── src/embed/main.tsx ────────────────────────────────────────────────────
    'apps/widget/src/embed/main.tsx': `\
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbedPage } from './EmbedPage.js';

const root = document.getElementById('root');
if (!root) throw new Error('[Widget] #root element not found');

createRoot(root).render(
  <StrictMode>
    <EmbedPage />
  </StrictMode>
);
`,
  };
}
