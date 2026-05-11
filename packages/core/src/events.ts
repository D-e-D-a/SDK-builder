/**
 * Typed event emitter for the public SDK event surface.
 *
 * Design rules:
 *  - `on()` returns an unsubscribe function — not `this`.
 *    Returning `this` would make cleanup impossible in React effects.
 *  - Handler errors are caught and logged — one bad handler cannot
 *    silently break subsequent handlers or crash the SDK.
 *  - `removeAll()` is called on destroy — no leaks.
 *  - Keyed by `SDKEventName` union — TypeScript ensures correct payload types.
 */

export interface SDKEventMap {
  /** Widget is fully initialised and ready to receive commands. */
  ready:         { protocolVersion: number };
  /** An unrecoverable or recoverable error occurred. */
  error:         { code: string; message: string; fatal: boolean };
  /** Authentication was accepted by the widget. */
  'auth:success': { userId?: string; sessionId?: string };
  /** Authentication was rejected by the widget. */
  'auth:fail':    { reason: string; code?: string };
  /** Widget's current auth token has expired — consumer must re-identify. */
  'auth:expired': Record<string, never>;
  /** FSM moved to a new state. */
  'state:change': { previous: string; current: string };
  /** Widget sent a named event (e.g. user action, deep-link). */
  event:          { name: string; data: unknown };
  /** SDK was destroyed. All listeners will be removed after this fires. */
  destroy:        Record<string, never>;
}

export type SDKEventName = keyof SDKEventMap;
type Handler<K extends SDKEventName> = (payload: SDKEventMap[K]) => void;

export class EventEmitter {
  private _listeners = new Map<SDKEventName, Set<Handler<SDKEventName>>>();

  on<K extends SDKEventName>(event: K, handler: Handler<K>): () => void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler as Handler<SDKEventName>);
    return () => this.off(event, handler);
  }

  off<K extends SDKEventName>(event: K, handler: Handler<K>): void {
    this._listeners.get(event)?.delete(handler as Handler<SDKEventName>);
  }

  emit<K extends SDKEventName>(event: K, payload: SDKEventMap[K]): void {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const h of set) {
      try { (h as Handler<K>)(payload); }
      catch (err) { console.error(`[SDK] Uncaught error in "${event}" handler:`, err); }
    }
  }

  removeAll(): void {
    this._listeners.clear();
  }
}
