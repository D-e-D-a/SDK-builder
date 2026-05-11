import type { Config } from '../types.js';

export function generateCore(c: Config): Record<string, string> {
  const protocolPkg = `${c.scope}/protocol`;

  return {
    // ── package manifest ────────────────────────────────────────────────────
    'packages/core/package.json': JSON.stringify(
      {
        name: `${c.scope}/core`,
        version: '0.1.0',
        type: 'module',
        exports: {
          '.': {
            import: './dist/index.js',
            types: './dist/index.d.ts',
          },
        },
        main: './dist/index.js',
        types: './dist/index.d.ts',
        scripts: {
          build: 'tsup src/index.ts --format esm --dts --clean',
          dev: 'tsup src/index.ts --format esm --watch',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          [protocolPkg]: 'workspace:*',
          zod: '^3.23.0',
        },
        devDependencies: {
          tsup: '^8.1.0',
          typescript: '^5.5.0',
        },
      },
      null,
      2
    ),

    'packages/core/tsconfig.json': JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src'],
      },
      null,
      2
    ),

    // ── src/global.d.ts ────────────────────────────────────────────────────
    'packages/core/src/global.d.ts': `\
declare const process: { env: { NODE_ENV?: string } };
`,

    // ── src/fsm.ts ─────────────────────────────────────────────────────────
    'packages/core/src/fsm.ts': `\
export type SDKState =
  | { name: 'IDLE' }
  | { name: 'MOUNTING' }
  | { name: 'HANDSHAKING'; startedAt: number }
  | { name: 'AUTHENTICATING'; startedAt: number; messageId: string }
  | { name: 'READY'; since: number; protocolVersion: number }
  | { name: 'RECONNECTING'; attempt: number; backoffMs: number }
  | { name: 'ERROR'; code: string; message: string; fatal: boolean }
  | { name: 'DESTROYED' };

export type SDKStateName = SDKState['name'];

/** Legal transitions — everything else is rejected */
const TRANSITIONS: Record<SDKStateName, SDKStateName[]> = {
  IDLE:           ['MOUNTING'],
  MOUNTING:       ['HANDSHAKING', 'ERROR'],
  HANDSHAKING:    ['AUTHENTICATING', 'RECONNECTING', 'ERROR'],
  AUTHENTICATING: ['READY', 'RECONNECTING', 'ERROR'],
  READY:          ['RECONNECTING', 'DESTROYED', 'ERROR'],
  RECONNECTING:   ['MOUNTING', 'ERROR', 'DESTROYED'],
  ERROR:          ['MOUNTING', 'DESTROYED'],
  DESTROYED:      [],
};

export type StateChangeHandler = (next: SDKState, prev: SDKState) => void;

export class StateMachine {
  private _state: SDKState = { name: 'IDLE' };
  private _handlers: StateChangeHandler[] = [];

  get state(): SDKState {
    return this._state;
  }

  get name(): SDKStateName {
    return this._state.name;
  }

  transition(next: SDKState): boolean {
    const allowed = TRANSITIONS[this._state.name] ?? [];
    if (!allowed.includes(next.name)) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.warn(
          \`[SDK FSM] Illegal transition \${this._state.name} → \${next.name}\`
        );
      }
      return false;
    }
    const prev = this._state;
    this._state = next;
    for (const h of this._handlers) h(next, prev);
    return true;
  }

  onTransition(handler: StateChangeHandler): () => void {
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  is<N extends SDKStateName>(name: N): this is StateMachine & { state: Extract<SDKState, { name: N }> } {
    return this._state.name === name;
  }
}
`,

    // ── src/queue.ts ───────────────────────────────────────────────────────
    'packages/core/src/queue.ts': `\
import type { Envelope } from '${protocolPkg}';

export const Priority = {
  CRITICAL: 0,
  HIGH:     1,
  NORMAL:   2,
  LOW:      3,
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

export interface QueuedMessage {
  envelope: Envelope;
  priority: Priority;
  /** Epoch ms after which this entry is discarded (0 = never) */
  expiresAt: number;
  enqueuedAt: number;
}

function sortByPriority(a: QueuedMessage, b: QueuedMessage): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.enqueuedAt - b.enqueuedAt;
}

export class MessageQueue {
  private _items: QueuedMessage[] = [];

  enqueue(
    envelope: Envelope,
    priority: Priority = Priority.NORMAL,
    ttlMs = 0
  ): void {
    this._items.push({
      envelope,
      priority,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
      enqueuedAt: Date.now(),
    });
    this._items.sort(sortByPriority);
  }

  /** Drain messages up to given max priority (inclusive), discarding expired */
  flush(maxPriority: Priority = Priority.LOW): Envelope[] {
    const now = Date.now();
    const result: Envelope[] = [];
    const remaining: QueuedMessage[] = [];

    for (const item of this._items) {
      if (item.expiresAt > 0 && item.expiresAt < now) continue; // expired
      if (item.priority <= maxPriority) {
        result.push(item.envelope);
      } else {
        remaining.push(item);
      }
    }

    this._items = remaining;
    return result;
  }

  /** Drop low-priority messages, keep CRITICAL + HIGH for reconnect replay */
  trim(): void {
    this._items = this._items.filter((i) => i.priority <= Priority.HIGH);
  }

  get size(): number {
    return this._items.length;
  }

  clear(): void {
    this._items = [];
  }
}
`,

    // ── src/ack.ts ─────────────────────────────────────────────────────────
    'packages/core/src/ack.ts': `\
import type { Envelope } from '${protocolPkg}';

export interface PendingAck {
  id: string;
  envelope: Envelope;
  attempt: number;
  maxAttempts: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (ack: Envelope) => void;
  reject: (err: Error) => void;
}

export type ResendFn = (envelope: Envelope) => void;

export class AckManager {
  private _pending = new Map<string, PendingAck>();

  /** Track an outbound message that requires ACK.
   *  Returns a Promise that resolves when the ACK arrives or rejects on timeout. */
  track(
    envelope: Envelope,
    resend: ResendFn,
    options?: { timeoutMs?: number; maxAttempts?: number }
  ): Promise<Envelope> {
    const timeoutMs  = options?.timeoutMs  ?? 5_000;
    const maxAttempts = options?.maxAttempts ?? 3;

    return new Promise<Envelope>((resolve, reject) => {
      const attempt = (attempt: number) => {
        const timer = setTimeout(() => {
          if (attempt < maxAttempts) {
            resend(envelope);
            attempt_fn(attempt + 1);
          } else {
            this._pending.delete(envelope.id);
            reject(new Error(\`ACK timeout for message \${envelope.id} after \${maxAttempts} attempts\`));
          }
        }, timeoutMs * Math.pow(1.5, attempt));

        this._pending.set(envelope.id, {
          id: envelope.id,
          envelope,
          attempt,
          maxAttempts,
          timer,
          resolve,
          reject,
        });
      };

      const attempt_fn = attempt;
      attempt(0);
    });
  }

  /** Call when an ACK envelope arrives. Resolves the matching pending promise. */
  resolve(ackEnvelope: Envelope): boolean {
    if (!ackEnvelope.ackId) return false;
    const pending = this._pending.get(ackEnvelope.ackId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this._pending.delete(ackEnvelope.ackId);
    pending.resolve(ackEnvelope);
    return true;
  }

  /** Reject all pending ACKs (e.g. on destroy or reconnect) */
  rejectAll(reason: string): void {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this._pending.clear();
  }

  get size(): number {
    return this._pending.size;
  }
}
`,

    // ── src/transport.ts ───────────────────────────────────────────────────
    'packages/core/src/transport.ts': `\
import { parseEnvelope, createAck } from '${protocolPkg}';
import type { Envelope } from '${protocolPkg}';

export type MessageHandler = (envelope: Envelope) => void;

export class Transport {
  private _iframe: HTMLIFrameElement | null = null;
  private _origin = '*';
  private _handlers: MessageHandler[] = [];
  private _listener: ((e: MessageEvent) => void) | null = null;
  /** Rolling dedup set — prevents processing retransmitted messages twice */
  private _seen = new Map<string, number>();
  private static readonly MAX_SEEN = 800;
  private _debug = false;

  constructor(options?: { debug?: boolean }) {
    this._debug = options?.debug ?? false;
  }

  /** Attach to a specific iframe + expected origin */
  attach(iframe: HTMLIFrameElement, origin: string): void {
    this._iframe = iframe;
    this._origin = origin;

    if (!this._listener) {
      this._listener = this._onMessage.bind(this);
      window.addEventListener('message', this._listener);
    }
  }

  detach(): void {
    if (this._listener) {
      window.removeEventListener('message', this._listener);
      this._listener = null;
    }
    this._iframe = null;
  }

  send(envelope: Envelope): boolean {
    if (!this._iframe?.contentWindow) return false;
    try {
      this._iframe.contentWindow.postMessage(envelope, this._origin);
      if (this._debug) console.debug('[SDK transport →]', envelope.type, envelope.id);
      return true;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  private _onMessage(event: MessageEvent): void {
    // Origin guard
    if (this._origin !== '*' && event.origin !== this._origin) return;

    const envelope = parseEnvelope(event.data);
    if (!envelope) return;

    // Dedup
    if (this._isDuplicate(envelope.id)) return;

    // Auto-ACK if requested
    if (envelope.ack && this._iframe?.contentWindow) {
      const ack = createAck(envelope);
      this._iframe.contentWindow.postMessage(ack, this._origin);
    }

    if (this._debug) console.debug('[SDK transport ←]', envelope.type, envelope.id);

    for (const h of this._handlers) h(envelope);
  }

  private _isDuplicate(id: string): boolean {
    if (this._seen.has(id)) return true;
    this._seen.set(id, Date.now());
    if (this._seen.size > Transport.MAX_SEEN) {
      // evict oldest
      const [oldestKey] = this._seen.keys();
      if (oldestKey) this._seen.delete(oldestKey);
    }
    return false;
  }
}
`,

    // ── src/events.ts ──────────────────────────────────────────────────────
    'packages/core/src/events.ts': `\
export type SDKEventMap = {
  ready: { protocolVersion: number };
  error: { code: string; message: string; fatal: boolean };
  'auth:success': { userId?: string; sessionId?: string };
  'auth:fail': { reason: string; code?: string };
  'auth:expired': Record<string, never>;
  'state:change': { previous: string; current: string };
  event: { name: string; data: unknown };
  destroy: Record<string, never>;
};

export type SDKEventName = keyof SDKEventMap;
export type SDKEventPayload<K extends SDKEventName> = SDKEventMap[K];

type Handler<K extends SDKEventName> = (payload: SDKEventMap[K]) => void;

export class EventEmitter {
  private _listeners = new Map<string, Set<Handler<SDKEventName>>>();

  on<K extends SDKEventName>(event: K, handler: Handler<K>): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler as Handler<SDKEventName>);
    return () => this.off(event, handler);
  }

  off<K extends SDKEventName>(event: K, handler: Handler<K>): void {
    this._listeners.get(event)?.delete(handler as Handler<SDKEventName>);
  }

  emit<K extends SDKEventName>(event: K, payload: SDKEventMap[K]): void {
    this._listeners.get(event)?.forEach((h) => {
      try {
        (h as Handler<K>)(payload);
      } catch (err) {
        console.error(\`[SDK] Uncaught error in "\${event}" handler\`, err);
      }
    });
  }

  removeAllListeners(): void {
    this._listeners.clear();
  }
}
`,

    // ── src/sdk.ts ─────────────────────────────────────────────────────────
    'packages/core/src/sdk.ts': `\
import { createEnvelope, PROTOCOL_VERSION } from '${protocolPkg}';
import type { AuthRequestPayload } from '${protocolPkg}';
import { StateMachine } from './fsm.js';
import { MessageQueue, Priority } from './queue.js';
import { AckManager } from './ack.js';
import { Transport } from './transport.js';
import { EventEmitter } from './events.js';
import type { SDKEventName, SDKEventPayload } from './events.js';

export interface SDKConfig {
  /** Origin of the widget iframe, e.g. https://widget.myapp.com */
  widgetOrigin: string;
  /** Widget app URL (defaults to widgetOrigin + /embed) */
  widgetUrl?: string;
  /** CSS selector or element to mount the iframe in */
  mount?: string | HTMLElement;
  /** Provide a token for auth */
  getToken?: () => Promise<AuthRequestPayload> | AuthRequestPayload;
  /** Enable verbose logging */
  debug?: boolean;
  /** Timeout overrides */
  timeouts?: {
    handshakeMs?: number;
    authMs?: number;
    heartbeatMs?: number;
  };
  /** Called on any state change */
  onStateChange?: (current: string, previous: string) => void;
}

const DEFAULTS = {
  handshakeMs: 12_000,
  authMs: 10_000,
  heartbeatMs: 30_000,
};

export class EmbedSDK {
  readonly events = new EventEmitter();

  private _config: Required<SDKConfig>;
  private _fsm = new StateMachine();
  private _queue = new MessageQueue();
  private _ack = new AckManager();
  private _transport = new Transport();
  private _iframe: HTMLIFrameElement | null = null;
  private _timers: Record<string, ReturnType<typeof setTimeout> | null> = {};
  private _instanceId = \`sdk-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  private _negotiatedVersion: number = PROTOCOL_VERSION;
  private _heartbeatMisses = 0;

  constructor(config: SDKConfig) {
    this._config = {
      widgetOrigin: config.widgetOrigin,
      widgetUrl: config.widgetUrl ?? config.widgetOrigin + '/embed',
      mount: config.mount ?? 'body',
      getToken: config.getToken ?? (() => Promise.reject(new Error('getToken not configured'))),
      debug: config.debug ?? false,
      timeouts: config.timeouts ?? {},
      onStateChange: config.onStateChange ?? (() => {}),
    };

    this._transport = new Transport({ debug: this._config.debug });

    this._fsm.onTransition((next, prev) => {
      this._config.onStateChange(next.name, prev.name);
      this.events.emit('state:change', { current: next.name, previous: prev.name });
    });

    this._transport.onMessage(this._handleMessage.bind(this));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  on<K extends SDKEventName>(event: K, handler: (payload: SDKEventPayload<K>) => void): () => void {
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  off<K extends SDKEventName>(event: K, handler: (payload: SDKEventPayload<K>) => void): void {
    this.events.off(event, handler);
  }

  get state(): string {
    return this._fsm.name;
  }

  init(): this {
    if (this._fsm.name !== 'IDLE') {
      this._log('warn', 'init() called on non-idle SDK — ignored');
      return this;
    }
    this._mount();
    return this;
  }

  open(): this {
    this._sendWhenReady(createEnvelope('WIDGET_OPEN', null), Priority.HIGH);
    return this;
  }

  close(): this {
    this._sendWhenReady(createEnvelope('WIDGET_CLOSE', null), Priority.HIGH);
    return this;
  }

  /** Re-authenticate with a new token */
  identify(payload: AuthRequestPayload): this {
    this._sendAuth(payload);
    return this;
  }

  destroy(): void {
    this._teardown();
    this._fsm.transition({ name: 'DESTROYED' });
    this.events.emit('destroy', {});
    this.events.removeAllListeners();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _log(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
    if (!this._config.debug && level === 'log') return;
    console[level]('[SDK]', ...args);
  }

  private _mount(): void {
    this._fsm.transition({ name: 'MOUNTING' });

    const iframe = document.createElement('iframe');
    iframe.id = 'embed-sdk-frame';
    const src = new URL(this._config.widgetUrl);
    src.searchParams.set('parentOrigin', window.location.origin);
    iframe.src = src.toString();
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('title', 'Embed widget');
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:transparent;overflow:hidden';

    iframe.onerror = () => {
      this._clearTimer('mount');
      this._onError('IFRAME_BLOCKED', 'Widget iframe failed to load', true);
    };

    const mountEl =
      typeof this._config.mount === 'string'
        ? (document.querySelector(this._config.mount) ?? document.body)
        : this._config.mount;

    mountEl.appendChild(iframe);
    this._iframe = iframe;
    this._transport.attach(iframe, this._config.widgetOrigin);

    // Transition to HANDSHAKING once mounted
    const timeouts = { ...DEFAULTS, ...this._config.timeouts };
    this._fsm.transition({ name: 'HANDSHAKING', startedAt: Date.now() });

    this._setTimer('handshake', () => {
      if (this._fsm.name === 'HANDSHAKING') {
        this._onError('HANDSHAKE_TIMEOUT', 'Widget did not complete handshake in time', true);
      }
    }, timeouts.handshakeMs);
  }

  private _sendHandshake(): void {
    const envelope = createEnvelope('HANDSHAKE_INIT', {
      sdkVersion: '0.1.0',
      protocolVersions: [PROTOCOL_VERSION, 1],
      capabilities: ['auth', 'resize', 'heartbeat'],
      parentOrigin: window.location.origin,
      instanceId: this._instanceId,
    }, { ack: true });

    this._transport.send(envelope);
    this._ack.track(envelope, (e) => this._transport.send(e));
  }

  private async _sendAuth(payload?: AuthRequestPayload): Promise<void> {
    if (this._fsm.name !== 'READY' && this._fsm.name !== 'HANDSHAKING') return;

    let authPayload: AuthRequestPayload;
    try {
      authPayload = payload ?? await this._config.getToken();
    } catch (err) {
      this._onError('AUTH_RESOLVE_FAILED', String(err), true);
      return;
    }

    const envelope = createEnvelope('AUTH_REQUEST', authPayload, { ack: true });
    const msgId = envelope.id;
    this._fsm.transition({ name: 'AUTHENTICATING', startedAt: Date.now(), messageId: msgId });

    const timeouts = { ...DEFAULTS, ...this._config.timeouts };
    this._setTimer('auth', () => {
      if (this._fsm.name === 'AUTHENTICATING') {
        this._onError('AUTH_TIMEOUT', 'Authentication timed out', true);
      }
    }, timeouts.authMs);

    this._transport.send(envelope);
  }

  private _sendWhenReady(envelope: ReturnType<typeof createEnvelope>, priority: Priority): void {
    if (this._fsm.name === 'READY') {
      this._transport.send(envelope);
    } else {
      this._queue.enqueue(envelope, priority, 30_000);
    }
  }

  private _handleMessage(envelope: import('${protocolPkg}').Envelope): void {
    this._log('log', '←', envelope.type);

    switch (envelope.type) {
      case 'HANDSHAKE_ACK': {
        const p = envelope.payload as { protocolVersion: number; instanceId: string };
        this._negotiatedVersion = p.protocolVersion;
        this._clearTimer('handshake');
        this._sendAuth();
        break;
      }

      case 'WIDGET_READY': {
        // Widget signals it is ready (pre-auth flow variant)
        if (this._fsm.name === 'MOUNTING') {
          this._sendHandshake();
        }
        break;
      }

      case 'AUTH_SUCCESS': {
        const p = envelope.payload as { userId?: string; sessionId?: string };
        this._clearTimer('auth');
        this._fsm.transition({ name: 'READY', since: Date.now(), protocolVersion: this._negotiatedVersion });
        this.events.emit('auth:success', {
          ...(p.userId    !== undefined && { userId:    p.userId    }),
          ...(p.sessionId !== undefined && { sessionId: p.sessionId }),
        });
        this.events.emit('ready', { protocolVersion: this._negotiatedVersion });
        this._flushQueue();
        this._startHeartbeat();
        break;
      }

      case 'AUTH_FAIL': {
        const p = envelope.payload as { reason: string; code?: string };
        this._clearTimer('auth');
        this.events.emit('auth:fail', {
          reason: p.reason,
          ...(p.code !== undefined && { code: p.code }),
        });
        this._onError('AUTH_FAILED', p.reason, true);
        break;
      }

      case 'AUTH_EXPIRED': {
        this.events.emit('auth:expired', {});
        this._sendAuth(); // attempt automatic refresh
        break;
      }

      case 'WIDGET_RESIZE': {
        const p = envelope.payload as { styles?: Record<string, string>; height?: string; width?: string };
        if (this._iframe && p.styles) {
          Object.assign(this._iframe.style, p.styles);
        }
        break;
      }

      case 'PUSH_EVENT': {
        const p = envelope.payload as { event: string; data: unknown };
        this.events.emit('event', { name: p.event, data: p.data });
        break;
      }

      case 'HEARTBEAT_PONG': {
        this._heartbeatMisses = 0;
        break;
      }

      case 'REQUEST_RECT': {
        const p = envelope.payload as { correlationId: string };
        if (this._iframe) {
          const rect = this._iframe.getBoundingClientRect();
          this._transport.send(createEnvelope('RECT_RESPONSE', {
            correlationId: p.correlationId,
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          }));
        }
        break;
      }
    }
  }

  private _startHeartbeat(): void {
    const timeouts = { ...DEFAULTS, ...this._config.timeouts };
    const tick = () => {
      if (this._fsm.name !== 'READY') return;
      this._transport.send(createEnvelope('HEARTBEAT_PING', null));
      this._heartbeatMisses++;
      if (this._heartbeatMisses >= 3) {
        this._log('warn', 'Heartbeat lost — triggering reconnect');
        this._reconnect();
        return;
      }
      this._setTimer('heartbeat', tick, timeouts.heartbeatMs);
    };
    this._setTimer('heartbeat', tick, timeouts.heartbeatMs);
  }

  private _reconnect(): void {
    const attempt = this._fsm.name === 'RECONNECTING'
      ? (this._fsm.state as Extract<import('./fsm.js').SDKState, { name: 'RECONNECTING' }>).attempt + 1
      : 0;
    const backoffMs = Math.min(500 * Math.pow(2, attempt), 16_000);

    this._teardownIframe();
    this._ack.rejectAll('reconnecting');
    this._queue.trim();
    this._fsm.transition({ name: 'RECONNECTING', attempt, backoffMs });

    this._setTimer('reconnect', () => this._mount(), backoffMs);
  }

  private _flushQueue(): void {
    for (const envelope of this._queue.flush()) {
      this._transport.send(envelope);
    }
  }

  private _teardownIframe(): void {
    this._transport.detach();
    this._iframe?.remove();
    this._iframe = null;
  }

  private _teardown(): void {
    for (const name of Object.keys(this._timers)) this._clearTimer(name);
    this._ack.rejectAll('destroyed');
    this._queue.clear();
    this._teardownIframe();
  }

  private _onError(code: string, message: string, fatal: boolean): void {
    this.events.emit('error', { code, message, fatal });
    if (fatal) {
      this._fsm.transition({ name: 'ERROR', code, message, fatal });
    }
  }

  private _setTimer(name: string, fn: () => void, ms: number): void {
    this._clearTimer(name);
    this._timers[name] = setTimeout(fn, ms);
  }

  private _clearTimer(name: string): void {
    const t = this._timers[name];
    if (t != null) clearTimeout(t);
    this._timers[name] = null;
  }
}
`,

    // ── src/index.ts ───────────────────────────────────────────────────────
    'packages/core/src/index.ts': `\
export { EmbedSDK } from './sdk.js';
export { StateMachine } from './fsm.js';
export { MessageQueue, Priority } from './queue.js';
export { AckManager } from './ack.js';
export { Transport } from './transport.js';
export { EventEmitter } from './events.js';
export type { SDKConfig } from './sdk.js';
export type { SDKState, SDKStateName } from './fsm.js';
export type { SDKEventMap, SDKEventName, SDKEventPayload } from './events.js';
export type { AuthRequestPayload } from '${protocolPkg}';
`,
  };
}
