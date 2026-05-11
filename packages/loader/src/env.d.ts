/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the widget iframe page (e.g. https://widget.example.com/embed) */
  readonly VITE_WIDGET_URL: string;
  /** Origin of the widget iframe (e.g. https://widget.example.com) */
  readonly VITE_WIDGET_ORIGIN: string;
  /** URL to the pre-built core SDK IIFE bundle */
  readonly VITE_SDK_URL: string;
  /** Endpoint the loader will GET to fetch a short-lived token */
  readonly VITE_TOKEN_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
