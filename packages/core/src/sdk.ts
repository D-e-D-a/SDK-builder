import {
  createEnvelope,
  parsePayload,
  negotiateVersion,
  PROTOCOL_VERSION,
  ErrorCode,
} from '@embed-sdk/protocol';
import type {
  Envelope,
  AuthRequestPayload,
  HandshakeAckPayload,
  AuthSuccessPayload,
  AuthFailPayload,
  WidgetResizePayload,
  PushEventPayload,
  RequestRectPayload,
} from '@embed-sdk/protocol';

import { StateMachine } from './fsm.js';
import { EventEmitter } from './events.js';
import { MessageQueue, Priority } from './queue.js';
import { Transport } from './transport.js';
import type { SDKEventName, SDKEventMap } from './events.js';

export interface SDKConfig {
  /** Origin where the widget iframe is hosted, e.g. https://widget.myapp.com */
  widgetOrigin: string;
  /** Full URL of the embed page. Defaults to widgetOrigin + /embed */
  widgetUrl?: string;
  /**
   * Where to mount the iframe. Accepts a CSS selector string, an Element,
   * or undefined (defaults to document.body).
   */
  mount?: string | Element;
  /**
   * Called to obtain an auth token when the widget requests authentication.
   * May be async. If absent the SDK will attempt to proceed without auth
   * (the widget decides if auth is required).
   */
  getToken?: () => Promise<AuthRequestPayload> | AuthRequestPayload;
  /** Enable verbose transport/lifecycle logs. */
  debug?: boolean;
  /** Timeout overrides in milliseconds. */
  timeouts?: {
    /** Time to wait for the handshake to complete. Default: 12 000 */
    handshakeMs?: number;
    /** Time to wait for the widget to respond to AUTH_REQUEST. Default: 10 000 */
    authMs?: number;
  };
}

const DEFAULTS = {
  handshakeMs: 12_000,
  authMs:      10_000,
} as const;

type Handler<K extends SDKEventName> = (payload: SDKEventMap[K]) => void;

export class EmbedSDK {
  // ── @internal testing seam — do not use in application code ──────────────
  readonly _transport: Transport;

  private readonly _config: Required<SDKConfig>;
  private readonly _fsm    = new StateMachine();
  private readonly _events  = new EventEmitter();
  private readonly _queue   = new MessageQueue();
  private _iframe: HTMLIFrameElement | null = null;
  private _timers: Record<string, ReturnType<typeof setTimeout> | null> = {};
  /** Instance ID of the widget we last handshook with. Detects iframe reloads. */
  private _remoteInstanceId: string | null = null;
  private _negotiatedVersion: number = PROTOCOL_VERSION;
  private _authMessageId: string | null = null;

  constructor(config: SDKConfig) {
    this._config = {
      widgetOrigin: config.widgetOrigin,
      widgetUrl:    config.widgetUrl ?? `${config.widgetOrigin}/embed`,
      mount:        config.mount ?? 'body',
      getToken:     config.getToken ?? (() => Promise.reject(new Error('getToken is not configured'))),
      debug:        config.debug ?? false,
      timeouts:     config.timeouts ?? {},
    };

    this._transport = new Transport({ debug: this._config.debug });

    // Propagate FSM transitions as 'state:change' events
    this._fsm.onTransition((next, prev) => {
      this._events.emit('state:change', { current: next.name, previous: prev.name });
    });

    this._transport.onMessage(env => this._handleMessage(env));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get state(): string { return this._fsm.name; }

  /**
   * Mount the iframe and begin the handshake → auth lifecycle.
   * Idempotent — safe to call multiple times (ignored after first call).
   */
  init(): this {
    if (this._fsm.name !== 'IDLE') {
      this._log('warn', 'init() called on non-idle SDK, ignored (state:', this._fsm.name + ')');
      return this;
    }
    this._mount();
    return this;
  }

  /** Tell the widget to show itself. Queued if not yet READY. */
  open(): this {
    this._sendOrQueue(createEnvelope('WIDGET_OPEN', {}), Priority.HIGH);
    return this;
  }

  /** Tell the widget to hide itself. Queued if not yet READY. */
  close(): this {
    this._sendOrQueue(createEnvelope('WIDGET_CLOSE', {}), Priority.HIGH);
    return this;
  }

  /**
   * Re-authenticate with a new token.
   * Queued if called before READY — the queue replays after auth completes.
   */
  identify(payload: AuthRequestPayload): this {
    this._sendOrQueue(
      createEnvelope('AUTH_REQUEST', payload, { ack: true }),
      Priority.CRITICAL
    );
    return this;
  }

  /** Subscribe to an SDK event. Returns an unsubscribe function. */
  on<K extends SDKEventName>(event: K, handler: Handler<K>): () => void {
    return this._events.on(event, handler);
  }

  /** Tear down the SDK: remove iframe, clear timers, remove listeners. */
  destroy(): void {
    this._teardown();
    this._fsm.transition({ name: 'DESTROYED' });
    this._events.emit('destroy', {});
    this._events.removeAll();
  }

  // ── Private — lifecycle ───────────────────────────────────────────────────

  private _mount(): void {
    this._fsm.transition({ name: 'MOUNTING' });

    const src = new URL(this._config.widgetUrl);
    // Let the widget know where to send messages back to
    src.searchParams.set('parentOrigin', window.location.origin);

    const iframe = document.createElement('iframe');
    iframe.id = 'embed-sdk-widget';
    iframe.src = src.toString();
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('title', 'Embedded widget');
    iframe.setAttribute('loading', 'eager');
    iframe.style.cssText =
      'width:100%;height:100%;border:0;background:transparent;overflow:hidden;display:block';

    iframe.onerror = () => {
      this._clearTimer('handshake');
      this._onError(ErrorCode.IFRAME_BLOCKED, 'Widget iframe failed to load', true);
    };

    this._getMountEl().appendChild(iframe);
    this._iframe = iframe;
    this._transport.attach(iframe, this._config.widgetOrigin);

    // Guard: if WIDGET_READY never arrives (blocked / CSP / wrong URL)
    const { handshakeMs } = this._resolveTimeouts();
    this._setTimer('handshake', () => {
      if (this._fsm.name === 'MOUNTING' || this._fsm.name === 'HANDSHAKING') {
        this._onError(ErrorCode.HANDSHAKE_TIMEOUT, 'Widget did not complete handshake in time', true);
      }
    }, handshakeMs);
  }

  private _sendHandshake(): void {
    const env = createEnvelope('HANDSHAKE_INIT', {
      sdkVersion: '0.1.0',
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: ['auth', 'resize'],
      parentOrigin: window.location.origin,
      instanceId: `sdk-${Date.now().toString(36)}`,
    }, { ack: false });

    this._transport.send(env);
    this._log('log', '→ HANDSHAKE_INIT');
  }

  private async _sendAuth(payload?: AuthRequestPayload): Promise<void> {
    let authPayload: AuthRequestPayload;

    if (payload) {
      authPayload = payload;
    } else {
      try {
        authPayload = await this._config.getToken();
      } catch (err) {
        this._onError(ErrorCode.AUTH_RESOLVE_FAILED, `getToken() rejected: ${String(err)}`, true);
        return;
      }
    }

    const env = createEnvelope('AUTH_REQUEST', authPayload, { ack: false });
    this._authMessageId = env.id;

    const ok = this._transport.send(env);
    if (!ok) return;

    this._fsm.transition({
      name: 'AUTHENTICATING',
      startedAt: Date.now(),
      messageId: env.id,
    });

    const { authMs } = this._resolveTimeouts();
    this._setTimer('auth', () => {
      if (this._fsm.name === 'AUTHENTICATING') {
        this._onError(ErrorCode.AUTH_TIMEOUT, 'Widget did not respond to AUTH_REQUEST in time', true);
      }
    }, authMs);

    this._log('log', '→ AUTH_REQUEST', env.id);
  }

  // ── Private — message handling ────────────────────────────────────────────

  private _handleMessage(env: Envelope): void {
    this._log('log', '← ', env.type, env.id);

    switch (env.type) {
      case 'WIDGET_READY':
        this._onWidgetReady();
        break;

      case 'HANDSHAKE_ACK':
        this._onHandshakeAck(env);
        break;

      case 'AUTH_SUCCESS':
        this._onAuthSuccess(env);
        break;

      case 'AUTH_FAIL':
        this._onAuthFail(env);
        break;

      case 'AUTH_EXPIRED':
        this._onAuthExpired();
        break;

      case 'WIDGET_RESIZE':
        this._onResize(env);
        break;

      case 'PUSH_EVENT':
        this._onPushEvent(env);
        break;

      case 'REQUEST_RECT':
        this._onRequestRect(env);
        break;

      case 'HEARTBEAT_PONG':
        // no-op for now; heartbeat management lives in a future plugin
        break;
    }
  }

  private _onWidgetReady(): void {
    if (this._fsm.name === 'MOUNTING') {
      // First READY — normal startup path
      this._fsm.transition({ name: 'HANDSHAKING', startedAt: Date.now() });
      this._sendHandshake();
      return;
    }

    if (this._fsm.name === 'READY' || this._fsm.name === 'AUTHENTICATING') {
      // WIDGET_READY while we're already live = iframe reloaded (SPA navigation, hot reload)
      this._log('warn', 'WIDGET_READY received after ready — iframe reloaded, reconnecting');
      this._reconnect();
    }
  }

  private _onHandshakeAck(env: Envelope): void {
    if (this._fsm.name !== 'HANDSHAKING') {
      this._log('warn', 'HANDSHAKE_ACK ignored — not in HANDSHAKING state');
      return;
    }

    const payload = parsePayload('HANDSHAKE_ACK', env.payload);
    if (!payload) {
      this._onError(ErrorCode.PROTOCOL_INCOMPATIBLE, 'HANDSHAKE_ACK payload is invalid', true);
      return;
    }

    const version = negotiateVersion([PROTOCOL_VERSION], [payload.negotiatedVersion]);
    if (version === null) {
      this._onError(
        ErrorCode.PROTOCOL_INCOMPATIBLE,
        `No common protocol version. Parent supports [${PROTOCOL_VERSION}], widget offered ${payload.negotiatedVersion}`,
        true
      );
      return;
    }

    this._negotiatedVersion = version;
    this._remoteInstanceId  = payload.instanceId;
    this._clearTimer('handshake');
    this._log('log', `Negotiated protocol v${version}`);

    void this._sendAuth();
  }

  private _onAuthSuccess(env: Envelope): void {
    if (this._fsm.name !== 'AUTHENTICATING') return;

    const payload = parsePayload('AUTH_SUCCESS', env.payload) as AuthSuccessPayload | null;
    this._clearTimer('auth');

    this._fsm.transition({
      name: 'READY',
      since: Date.now(),
      protocolVersion: this._negotiatedVersion,
    });

    this._events.emit('auth:success', {
      ...(payload?.userId    !== undefined && { userId:    payload.userId    }),
      ...(payload?.sessionId !== undefined && { sessionId: payload.sessionId }),
    });
    this._events.emit('ready', { protocolVersion: this._negotiatedVersion });

    this._flushQueue();
  }

  private _onAuthFail(env: Envelope): void {
    if (this._fsm.name !== 'AUTHENTICATING') return;

    const payload = parsePayload('AUTH_FAIL', env.payload) as AuthFailPayload | null;
    this._clearTimer('auth');

    this._events.emit('auth:fail', {
      reason: payload?.reason ?? 'Auth rejected',
      ...(payload?.code !== undefined && { code: payload.code }),
    });
    this._onError(ErrorCode.AUTH_FAILED, payload?.reason ?? 'Auth rejected', true);
  }

  private _onAuthExpired(): void {
    // Attempt a silent refresh via getToken(). If that fails, surface the event.
    // Wrap in Promise.resolve() because getToken may return sync or async.
    void Promise.resolve(this._config.getToken())
      .then(payload => {
        const env = createEnvelope('AUTH_REFRESH', payload);
        this._transport.send(env);
        this._log('log', '→ AUTH_REFRESH (silent token refresh)');
      })
      .catch(() => {
        // getToken() failed — the consumer must call identify() manually
        this._events.emit('auth:expired', {});
      });
  }

  private _onResize(env: Envelope): void {
    if (!this._iframe) return;
    const payload = parsePayload('WIDGET_RESIZE', env.payload) as WidgetResizePayload | null;
    if (!payload) return;

    if (payload.styles) {
      Object.assign(this._iframe.style, payload.styles);
    }
    if (payload.height) this._iframe.style.height = payload.height;
    if (payload.width)  this._iframe.style.width  = payload.width;
  }

  private _onPushEvent(env: Envelope): void {
    const payload = parsePayload('PUSH_EVENT', env.payload) as PushEventPayload | null;
    if (!payload) return;
    this._events.emit('event', { name: payload.event, data: payload.data });
  }

  private _onRequestRect(env: Envelope): void {
    if (!this._iframe) return;
    const payload = parsePayload('REQUEST_RECT', env.payload) as RequestRectPayload | null;
    if (!payload) return;

    const r = this._iframe.getBoundingClientRect();
    this._transport.send(createEnvelope('RECT_RESPONSE', {
      correlationId: payload.correlationId,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    }));
  }

  // ── Private — reconnect ───────────────────────────────────────────────────

  private _reconnect(): void {
    const currentAttempt =
      this._fsm.name === 'RECONNECTING'
        ? (this._fsm.state as Extract<import('./fsm.js').SDKState, { name: 'RECONNECTING' }>).attempt
        : 0;
    const attempt   = currentAttempt + 1;
    const backoffMs = Math.min(500 * 2 ** (attempt - 1), 16_000);

    this._clearTimer('handshake');
    this._clearTimer('auth');
    this._queue.trim(); // keep CRITICAL + HIGH for replay

    // Don't remove the iframe — it just reloaded, the element is still valid
    // but we need to refresh the transport's contentWindow reference
    if (this._iframe) {
      this._transport.updateTarget(this._iframe);
    }

    this._remoteInstanceId = null;
    this._authMessageId    = null;

    this._fsm.transition({ name: 'RECONNECTING', attempt, backoffMs });
    this._log('log', `Reconnecting in ${backoffMs}ms (attempt ${attempt})`);

    this._setTimer('reconnect', () => {
      // Treat the existing iframe as freshly mounting
      this._fsm.transition({ name: 'MOUNTING' });
      // Wait for the next WIDGET_READY from the reloaded frame
      const { handshakeMs } = this._resolveTimeouts();
      this._setTimer('handshake', () => {
        if (this._fsm.name === 'MOUNTING' || this._fsm.name === 'HANDSHAKING') {
          this._onError(ErrorCode.HANDSHAKE_TIMEOUT, 'Reconnect handshake timed out', true);
        }
      }, handshakeMs);
    }, backoffMs);
  }

  // ── Private — helpers ─────────────────────────────────────────────────────

  private _sendOrQueue(env: Envelope, priority: Priority): void {
    if (this._fsm.name === 'READY') {
      this._transport.send(env);
    } else {
      this._queue.enqueue(env, priority, 60_000);
    }
  }

  private _flushQueue(): void {
    for (const env of this._queue.flush()) {
      this._transport.send(env);
    }
  }

  private _getMountEl(): Element {
    const m = this._config.mount;
    if (m instanceof Element) return m;
    return document.querySelector(m) ?? document.body;
  }

  private _resolveTimeouts() {
    return {
      handshakeMs: this._config.timeouts.handshakeMs ?? DEFAULTS.handshakeMs,
      authMs:      this._config.timeouts.authMs      ?? DEFAULTS.authMs,
    };
  }

  private _onError(code: string, message: string, fatal: boolean): void {
    this._events.emit('error', { code, message, fatal });
    if (fatal) {
      this._teardown();
      this._fsm.transition({ name: 'ERROR', code, message, fatal });
    }
  }

  private _teardown(): void {
    for (const name of Object.keys(this._timers)) this._clearTimer(name);
    this._queue.clear();
    this._transport.detach();
    this._iframe?.remove();
    this._iframe = null;
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

  private _log(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
    if (!this._config.debug && level === 'log') return;
    console[level]('[SDK]', ...args);
  }
}
