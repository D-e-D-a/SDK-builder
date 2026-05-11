import type { Config } from '../types.js';

export function generateLoader(c: Config): Record<string, string> {
  const protocolPkg = `${c.scope}/protocol`;

  return {
    // ── package manifest ──────────────────────────────────────────────────────
    'packages/loader/package.json': JSON.stringify(
      {
        name: `${c.scope}/loader`,
        version: '0.1.0',
        private: true,
        description: 'Tiny IIFE embed.js loader (<3kb)',
        scripts: {
          build: 'vite build',
          'build:dev': 'vite build --mode development',
          dev: 'vite build --watch',
          typecheck: 'tsc --noEmit',
        },
        devDependencies: {
          typescript: '^5.5.0',
          vite: '^5.3.0',
        },
      },
      null,
      2
    ),

    'packages/loader/tsconfig.json': JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2
    ),

    // ── vite.config.ts ────────────────────────────────────────────────────────
    'packages/loader/vite.config.ts': `\
import { defineConfig } from 'vite';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../..');

export default defineConfig({
  // .env.development / .env.production live at the project root
  envDir: PROJECT_ROOT,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'EmbedSDKLoader',
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    rollupOptions: { external: [] },
  },
});
`,

    // ── src/env.d.ts ──────────────────────────────────────────────────────────
    'packages/loader/src/env.d.ts': `\
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIDGET_URL: string;
  readonly VITE_WIDGET_ORIGIN: string;
  readonly VITE_SDK_URL: string;
  readonly VITE_TOKEN_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
`,

    // ── src/index.ts — the loader IIFE ────────────────────────────────────────
    'packages/loader/src/index.ts': `\
/**
 * ${c.name} Loader — tiny IIFE (<3kb)
 *
 * Config priority (first defined wins):
 *   1. window.EmbedSDKConfig  — runtime override
 *   2. data-* attributes      — inline override (defer scripts only)
 *   3. import.meta.env.VITE_* — build-time defaults from .env files  ← primary
 *
 * Set values in .env.development / .env.production at the project root,
 * then build: pnpm --filter ${c.scope}/loader build
 *
 * Embed with zero HTML configuration:
 *   <script src="embed.js" async></script>
 */
(function (win: Window & typeof globalThis) {
  'use strict';

  if ((win as any).__esdk_loaded) return;
  (win as any).__esdk_loaded = 1;

  // ── Stub queue ──────────────────────────────────────────────────────────────
  type QueueEntry = readonly [string, unknown[]];
  const _q: QueueEntry[] = [];

  function mk(name: string) {
    return function (...args: unknown[]) { _q.push([name, args]); };
  }

  (win as any).EmbedSDK = {
    open:     mk('open'),
    close:    mk('close'),
    identify: mk('identify'),
    destroy:  mk('destroy'),
    on: function (...args: unknown[]) {
      _q.push(['on', args]);
      return function () {};
    },
  };

  // ── Config resolution ───────────────────────────────────────────────────────
  const _env = {
    widgetUrl:    import.meta.env.VITE_WIDGET_URL    ?? '',
    widgetOrigin: import.meta.env.VITE_WIDGET_ORIGIN ?? '',
    sdkUrl:       import.meta.env.VITE_SDK_URL       ?? '',
    tokenUrl:     import.meta.env.VITE_TOKEN_URL     ?? '',
  };

  const el  = document.currentScript as HTMLScriptElement | null;
  const cfg = (win as any).EmbedSDKConfig ?? {};

  function resolve(key: string, dataKey: string): string {
    return cfg[key] ?? el?.dataset[dataKey] ?? (_env as any)[key] ?? '';
  }

  const widgetUrl    = resolve('widgetUrl',    'widgetUrl');
  const widgetOrigin = resolve('widgetOrigin', 'widgetOrigin');
  const sdkUrl       = resolve('sdkUrl',       'sdkUrl');
  const tokenUrl     = resolve('tokenUrl',     'tokenUrl');

  let getToken: (() => Promise<{ token: string }>) | undefined = cfg.getToken;
  if (!getToken && tokenUrl) {
    getToken = async function () {
      const res = await fetch(tokenUrl);
      if (!res.ok) throw new Error('[EmbedSDK] Token fetch failed: ' + res.status);
      return res.json() as Promise<{ token: string }>;
    };
  }

  if (!widgetUrl || !sdkUrl) {
    console.error('[EmbedSDK Loader] widgetUrl and sdkUrl are required. Check your .env file.');
    return;
  }

  if (!getToken) {
    console.error('[EmbedSDK Loader] tokenUrl or window.EmbedSDKConfig.getToken is required.');
    return;
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  function boot() {
    const s = document.createElement('script');
    s.type    = 'module';
    s.src     = sdkUrl;
    s.onerror = function () {
      console.error('[EmbedSDK Loader] Failed to load SDK bundle from:', sdkUrl);
    };
    s.onload = function () {
      const mod = (win as any).__EmbedSDK as { EmbedSDK: new (cfg: object) => any } | undefined;
      if (!mod?.EmbedSDK) {
        console.error('[EmbedSDK Loader] SDK bundle did not expose window.__EmbedSDK');
        return;
      }

      const sdk = new mod.EmbedSDK({ widgetUrl, widgetOrigin, getToken });

      for (const [name, args] of _q) {
        if (name === 'on') sdk.on(...(args as [string, ...unknown[]]));
      }

      sdk.init();

      for (const [name, args] of _q) {
        if (name !== 'on') {
          const fn = (sdk as any)[name];
          if (typeof fn === 'function') (fn as Function).apply(sdk, args);
        }
      }

      (win as any).EmbedSDK = sdk;
    };

    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
`,

    // ── .env files ────────────────────────────────────────────────────────────
    '.env.example': `\
# EmbedSDK Configuration
# Copy to .env.development and .env.production and fill in your values.

VITE_WIDGET_URL=https://widget.example.com/embed
VITE_WIDGET_ORIGIN=https://widget.example.com
VITE_SDK_URL=https://cdn.example.com/embed-sdk-core.iife.js
VITE_TOKEN_URL=/api/embed-token
`,

    '.env.development': `\
VITE_WIDGET_URL=http://localhost:5174/embed
VITE_WIDGET_ORIGIN=http://localhost:5174
VITE_SDK_URL=http://localhost:5175/embed-sdk-core.iife.js
VITE_TOKEN_URL=http://localhost:3000/api/embed-token
`,

    '.env.production': `\
# Fill in your production values before running pnpm build
VITE_WIDGET_URL=${c.widgetOrigin}/embed
VITE_WIDGET_ORIGIN=${c.widgetOrigin}
VITE_SDK_URL=https://cdn.example.com/embed-sdk-core.iife.js
VITE_TOKEN_URL=/api/embed-token
`,
  };
}
