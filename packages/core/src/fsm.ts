/**
 * Finite state machine for the embed SDK lifecycle.
 *
 * Design rules:
 *  - Zero DOM/timer dependencies. Fully testable in Node.js.
 *  - State is a discriminated union — TypeScript narrows it at every branch.
 *  - All transitions go through `transition()`. No state mutation anywhere else.
 *  - Illegal transitions are rejected (returns false) and warned in dev.
 *  - DESTROYED is a terminal state — no further transitions are possible.
 */

export type SDKState =
  | { name: 'IDLE' }
  | { name: 'MOUNTING' }
  | { name: 'HANDSHAKING';    startedAt: number }
  | { name: 'AUTHENTICATING'; startedAt: number; messageId: string }
  | { name: 'READY';          since: number; protocolVersion: number }
  | { name: 'RECONNECTING';   attempt: number; backoffMs: number }
  | { name: 'ERROR';          code: string; message: string; fatal: boolean }
  | { name: 'DESTROYED' };

export type SDKStateName = SDKState['name'];

/**
 * Every key lists the states it may legally transition INTO.
 * This is the single canonical source of valid transitions.
 * Change it here and the type system enforces it everywhere.
 */
const LEGAL_TRANSITIONS: Record<SDKStateName, ReadonlyArray<SDKStateName>> = {
  IDLE:           ['MOUNTING', 'DESTROYED'],
  MOUNTING:       ['HANDSHAKING', 'ERROR', 'DESTROYED'],
  HANDSHAKING:    ['AUTHENTICATING', 'RECONNECTING', 'ERROR', 'DESTROYED'],
  AUTHENTICATING: ['READY', 'RECONNECTING', 'ERROR', 'DESTROYED'],
  READY:          ['RECONNECTING', 'DESTROYED', 'ERROR'],
  RECONNECTING:   ['MOUNTING', 'ERROR', 'DESTROYED'],
  ERROR:          ['MOUNTING', 'DESTROYED'],
  DESTROYED:      [], // terminal — nothing is legal from here
};

export type TransitionHandler = (next: SDKState, prev: SDKState) => void;

export class StateMachine {
  private _current: SDKState = { name: 'IDLE' };
  private _listeners: TransitionHandler[] = [];

  get state(): SDKState   { return this._current; }
  get name():  SDKStateName { return this._current.name; }

  /**
   * Attempt to move to `next` state.
   * Returns true if the transition was applied, false if illegal.
   * Listeners are called synchronously after a successful transition.
   */
  transition(next: SDKState): boolean {
    const legal = LEGAL_TRANSITIONS[this._current.name];
    if (!legal.includes(next.name)) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.warn(`[SDK FSM] Illegal: ${this._current.name} → ${next.name}`);
      }
      return false;
    }

    const prev = this._current;
    this._current = next;

    for (const h of this._listeners) {
      try { h(next, prev); }
      catch (err) { console.error('[SDK FSM] Listener threw:', err); }
    }

    return true;
  }

  /**
   * Register a listener that fires on every successful transition.
   * Returns an unsubscribe function.
   */
  onTransition(handler: TransitionHandler): () => void {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter(h => h !== handler);
    };
  }

  /** Type-narrowing helper. */
  is<N extends SDKStateName>(
    name: N
  ): this is { state: Extract<SDKState, { name: N }> } & StateMachine {
    return this._current.name === name;
  }

  /** Force reset to IDLE — only for testing. */
  _reset(): void {
    this._current = { name: 'IDLE' };
  }
}
