/**
 * EmbedSDK Loader — tiny IIFE (<3kb minified)
 *
 * Config resolution order (first defined wins):
 *   1. window.EmbedSDKConfig   — runtime override (multi-tenant, server-rendered)
 *   2. data-* attributes       — inline override (defer scripts only)
 *   3. import.meta.env.VITE_*  — build-time defaults from .env files  ← primary
 *
 * Define your project values once in .env.development / .env.production:
 *
 *   VITE_WIDGET_URL=https://widget.example.com/embed
 *   VITE_WIDGET_ORIGIN=https://widget.example.com
 *   VITE_SDK_URL=https://cdn.example.com/embed-sdk-core.iife.js
 *   VITE_TOKEN_URL=/api/embed-token
 *
 * Then embed with zero configuration needed in HTML:
 *
 *   <script src="embed.js" async></script>
 *
 * Or override per-page (e.g. for multi-tenant):
 *
 *   <script>
 *     window.EmbedSDKConfig = { widgetUrl: 'https://tenant-a.widget.com/embed', ... };
 *   </script>
 *   <script src="embed.js" async></script>
 */
(function (win: Window & typeof globalThis) {
  'use strict';

  // Singleton guard — safe to include the tag more than once
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
      return function () { /* no-op until real SDK takes over */ };
    },
  };

  // ── Config resolution ───────────────────────────────────────────────────────

  // Build-time defaults — Vite replaces import.meta.env.VITE_* at compile time.
  // These are the values from your .env.development / .env.production files.
  const _env = {
    widgetUrl:    import.meta.env.VITE_WIDGET_URL    ?? '',
    widgetOrigin: import.meta.env.VITE_WIDGET_ORIGIN ?? '',
    sdkUrl:       import.meta.env.VITE_SDK_URL       ?? '',
    tokenUrl:     import.meta.env.VITE_TOKEN_URL     ?? '',
  };

  // Runtime overrides — checked in order: global config → data attributes → env defaults
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
    console.error(
      '[EmbedSDK Loader] widgetUrl and sdkUrl are required.\n' +
      'Set VITE_WIDGET_URL and VITE_SDK_URL in your .env file and rebuild embed.js.'
    );
    return;
  }

  if (!getToken) {
    console.error(
      '[EmbedSDK Loader] A token source is required.\n' +
      'Set VITE_TOKEN_URL in your .env file, or provide window.EmbedSDKConfig.getToken at runtime.'
    );
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

      // 1. Register event handlers first — they must be live before init fires events
      for (const [name, args] of _q) {
        if (name === 'on') sdk.on(...(args as Parameters<typeof sdk.on>));
      }

      // 2. Init — starts MOUNTING, fires state:change immediately
      sdk.init();

      // 3. Replay remaining calls (open, close, identify, destroy)
      //    SDK's internal message queue handles ordering if not yet READY
      for (const [name, args] of _q) {
        if (name !== 'on') {
          const fn = (sdk as any)[name];
          if (typeof fn === 'function') (fn as Function).apply(sdk, args);
        }
      }

      // Hand off — window.EmbedSDK is now the real SDK instance
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
