/**
 * IIFE entry point for the core SDK bundle.
 *
 * Built by Vite (not tsup) into dist/iife/embed-sdk-core.iife.js.
 * Loaded at runtime by the loader (<3kb embed.js) via dynamic <script type="module">.
 *
 * Exposes: window.__EmbedSDK = { EmbedSDK }
 */
import { EmbedSDK } from './sdk.js';

(window as Window & typeof globalThis & { __EmbedSDK: unknown }).__EmbedSDK = { EmbedSDK };
