/**
 * Widget-side postMessage transport.
 *
 * Mirrors the pattern of packages/core/src/transport.ts but inverted:
 *  - Sends TO window.parent (not to an iframe contentWindow)
 *  - Listens ON window (not on a child frame's events)
 *  - Origin comes from the parentOrigin URL param set by the parent SDK
 */
import { parseEnvelope } from '@embed-sdk/protocol';
import type { Envelope } from '@embed-sdk/protocol';

export type MessageHandler = (env: Envelope) => void;

export class WidgetTransport {
  private readonly _parentOrigin: string;
  private _handlers: MessageHandler[] = [];
  /** Rolling dedup map: id → received timestamp */
  private _seen = new Map<string, number>();
  private readonly _bound: (e: MessageEvent) => void;

  constructor(parentOrigin: string) {
    this._parentOrigin = parentOrigin;
    this._bound = (e: MessageEvent) => this._onMessage(e);
    window.addEventListener('message', this._bound);
  }

  /**
   * Post a pre-built envelope to the parent window.
   * No-ops if we're not in an iframe (top frame is same as parent).
   */
  send(env: Envelope): void {
    if (window.parent === window) return; // not in an iframe — dev fallback
    window.parent.postMessage(env, this._parentOrigin);
  }

  /** Register a handler for inbound messages. Returns an unsubscribe fn. */
  onMessage(handler: MessageHandler): () => void {
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter(h => h !== handler);
    };
  }

  /** Remove the event listener and drop all handlers. */
  destroy(): void {
    window.removeEventListener('message', this._bound);
    this._handlers = [];
  }

  private _onMessage(e: MessageEvent): void {
    // Origin guard — only accept messages from the declared parent
    if (e.origin !== this._parentOrigin) return;

    const env = parseEnvelope(e.data);
    if (!env) return;

    // Message dedup (rolling window — keeps the map from growing unbounded)
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
