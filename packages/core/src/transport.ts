import { parseEnvelope, SDK_SENTINEL } from '@embed-sdk/protocol';
import type { Envelope } from '@embed-sdk/protocol';

export type MessageHandler = (envelope: Envelope) => void;

/** Minimal interface for a postMessage target. Matches window/contentWindow. */
interface SendTarget {
  postMessage(data: unknown, targetOrigin: string): void;
}

/**
 * Thin wrapper around window.postMessage / iframe.contentWindow.postMessage.
 *
 * Responsibilities:
 *  - Origin validation (reject messages from unexpected origins)
 *  - Sentinel fast-path (cheap check before full Zod parse)
 *  - Deduplication (rolling map of seen message IDs)
 *  - Routing to registered handlers
 *
 * Testing seams (`_attachTarget`, `_deliver`) let tests drive the
 * full message-handling path without a real browser.
 */
export class Transport {
  private _sendTarget: SendTarget | null = null;
  private _origin = '*';
  private _handlers: MessageHandler[] = [];
  private _windowListener: ((e: MessageEvent) => void) | null = null;
  /** Rolling dedup set. Bounded to avoid unbounded memory growth. */
  private _seen = new Map<string, number>();
  private static readonly SEEN_LIMIT = 800;
  private readonly _debug: boolean;

  constructor(options?: { debug?: boolean }) {
    this._debug = options?.debug ?? false;
  }

  // ── Real browser API ───────────────────────────────────────────────────────

  /**
   * Attach to a mounted iframe.
   * Registers a `window.message` listener for inbound messages.
   * Safe to call again — only one listener is ever registered.
   */
  attach(iframe: HTMLIFrameElement, origin: string): void {
    this._sendTarget = iframe.contentWindow;
    this._origin = origin;
    this._ensureWindowListener();
  }

  /**
   * Call after an iframe reload — contentWindow will have changed.
   * Does not touch the window listener (it's still valid).
   */
  updateTarget(iframe: HTMLIFrameElement): void {
    this._sendTarget = iframe.contentWindow;
  }

  /** Remove the window listener and clear the send target. */
  detach(): void {
    if (this._windowListener) {
      window.removeEventListener('message', this._windowListener);
      this._windowListener = null;
    }
    this._sendTarget = null;
  }

  /** Post an envelope to the widget iframe. Returns false if no target. */
  send(envelope: Envelope): boolean {
    if (!this._sendTarget) return false;
    try {
      this._sendTarget.postMessage(envelope, this._origin);
      if (this._debug) console.debug('[Transport →]', envelope.type, envelope.id);
      return true;
    } catch {
      return false;
    }
  }

  /** Register a handler for validated inbound envelopes. Returns unsubscribe fn. */
  onMessage(handler: MessageHandler): () => void {
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter(h => h !== handler);
    };
  }

  // ── Testing seams (prefixed with _ to signal internal-only) ───────────────

  /**
   * @internal
   * Attach a mock send target without touching window.addEventListener.
   * Use this in tests that do not have a real DOM / real iframe.
   */
  _attachTarget(target: SendTarget, origin: string): void {
    this._sendTarget = target;
    this._origin = origin;
  }

  /**
   * @internal
   * Simulate an inbound postMessage from the widget.
   * Runs the full validation/dedup/routing pipeline.
   */
  _deliver(data: unknown, origin = this._origin): void {
    this._onMessage({ data, origin } as MessageEvent);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _ensureWindowListener(): void {
    if (this._windowListener) return;
    this._windowListener = (e: MessageEvent) => this._onMessage(e);
    window.addEventListener('message', this._windowListener);
  }

  private _onMessage(event: MessageEvent): void {
    // 1. Fast sentinel check — cheap, runs before Zod
    if (!this._isSdkMessage(event.data)) return;

    // 2. Origin guard
    if (this._origin !== '*' && event.origin !== this._origin) {
      if (this._debug) {
        console.debug('[Transport] Origin mismatch. Expected:', this._origin, 'Got:', event.origin);
      }
      return;
    }

    // 3. Full schema validation
    const envelope = parseEnvelope(event.data);
    if (!envelope) return;

    // 4. Deduplication
    if (this._isDuplicate(envelope.id)) {
      if (this._debug) console.debug('[Transport] Duplicate dropped:', envelope.id);
      return;
    }

    if (this._debug) console.debug('[Transport ←]', envelope.type, envelope.id);

    // 5. Route to handlers — errors are isolated per-handler
    for (const h of this._handlers) {
      try { h(envelope); }
      catch (err) { console.error('[Transport] Handler threw:', err); }
    }
  }

  private _isSdkMessage(data: unknown): boolean {
    return (
      data !== null &&
      typeof data === 'object' &&
      SDK_SENTINEL in data &&
      (data as Record<string, unknown>)[SDK_SENTINEL] === true
    );
  }

  private _isDuplicate(id: string): boolean {
    if (this._seen.has(id)) return true;
    this._seen.set(id, Date.now());
    // Evict oldest entry when limit is reached
    if (this._seen.size > Transport.SEEN_LIMIT) {
      const [oldest] = this._seen.keys();
      if (oldest) this._seen.delete(oldest);
    }
    return false;
  }
}
