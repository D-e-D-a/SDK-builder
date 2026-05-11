// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmbedSDK } from '../sdk.js';
import { createEnvelope } from '@embed-sdk/protocol';
import type { Envelope } from '@embed-sdk/protocol';

const ORIGIN = 'http://localhost:5174';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Creates an SDK instance ready for testing.
 *
 * `interceptSend()` MUST be called after `sdk.init()` to capture outbound
 * messages — init() → _mount() calls transport.attach() which overwrites
 * the send target, so we must re-inject the mock target after init.
 *
 * `deliver()` works at any time (it bypasses the send target, going straight
 * to the message handler pipeline).
 */
function makeSDK(overrides?: Partial<ConstructorParameters<typeof EmbedSDK>[0]>) {
  const sent: Envelope[] = [];

  const sdk = new EmbedSDK({
    widgetOrigin: ORIGIN,
    widgetUrl: `${ORIGIN}/embed`,
    getToken: vi.fn().mockResolvedValue({ token: 'test-tok' }),
    ...overrides,
  });

  /** Re-attach mock after sdk.init() so outbound messages are captured. */
  function interceptSend() {
    sdk._transport._attachTarget(
      { postMessage: (d) => sent.push(d as Envelope) },
      ORIGIN
    );
  }

  /** Simulate an inbound postMessage from the widget iframe. */
  function deliver(env: Envelope) {
    sdk._transport._deliver(env, ORIGIN);
  }

  /** Flush the microtask queue — lets async getToken() resolve without advancing timers. */
  async function flushMicrotasks() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  return { sdk, sent, deliver, interceptSend, flushMicrotasks };
}

// ── init() / state ─────────────────────────────────────────────────────────

describe('EmbedSDK — init', () => {
  it('starts in IDLE', () => {
    const { sdk } = makeSDK();
    expect(sdk.state).toBe('IDLE');
  });

  it('transitions to MOUNTING after init()', () => {
    const { sdk } = makeSDK();
    sdk.init();
    expect(sdk.state).toBe('MOUNTING');
    sdk.destroy();
  });

  it('init() is idempotent — second call is ignored', () => {
    const { sdk } = makeSDK();
    sdk.init();
    sdk.init();
    expect(sdk.state).toBe('MOUNTING');
    sdk.destroy();
  });

  it('mounts an iframe in the document', () => {
    const { sdk } = makeSDK();
    sdk.init();
    const iframe = document.getElementById('embed-sdk-widget');
    expect(iframe?.tagName).toBe('IFRAME');
    sdk.destroy();
  });

  it('iframe src includes parentOrigin param', () => {
    const { sdk } = makeSDK();
    sdk.init();
    const iframe = document.getElementById('embed-sdk-widget') as HTMLIFrameElement;
    expect(iframe.src).toContain('parentOrigin=');
    sdk.destroy();
  });
});

// ── Full lifecycle ─────────────────────────────────────────────────────────

describe('EmbedSDK — handshake → auth → ready', () => {
  it('transitions MOUNTING → HANDSHAKING on WIDGET_READY', () => {
    const { sdk, deliver } = makeSDK();
    sdk.init();
    expect(sdk.state).toBe('MOUNTING');

    deliver(createEnvelope('WIDGET_READY', {}));
    expect(sdk.state).toBe('HANDSHAKING');
    sdk.destroy();
  });

  it('sends HANDSHAKE_INIT after WIDGET_READY', () => {
    const { sdk, sent, deliver, interceptSend } = makeSDK();
    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    expect(sent.some(m => m.type === 'HANDSHAKE_INIT')).toBe(true);
    sdk.destroy();
  });

  it('transitions HANDSHAKING → AUTHENTICATING on HANDSHAKE_ACK', async () => {
    const { sdk, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    expect(sdk.state).toBe('HANDSHAKING');

    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0',
      negotiatedVersion: 1,
      capabilities: ['auth'],
      instanceId: 'w-inst-1',
    }));

    // Flush microtasks so async getToken() resolves and FSM transitions
    await flushMicrotasks();
    expect(sdk.state).toBe('AUTHENTICATING');
    sdk.destroy();
  });

  it('sends AUTH_REQUEST after HANDSHAKE_ACK', async () => {
    const { sdk, sent, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0',
      negotiatedVersion: 1,
      capabilities: [],
      instanceId: 'w-inst-1',
    }));

    await flushMicrotasks();
    expect(sent.some(m => m.type === 'AUTH_REQUEST')).toBe(true);
    sdk.destroy();
  });

  it('transitions to READY and emits ready + auth:success on AUTH_SUCCESS', async () => {
    const ready      = vi.fn();
    const authSuccess = vi.fn();
    const { sdk, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.on('ready', ready);
    sdk.on('auth:success', authSuccess);

    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0', negotiatedVersion: 1, capabilities: [], instanceId: 'w1',
    }));
    await flushMicrotasks();

    deliver(createEnvelope('AUTH_SUCCESS', { userId: 'u1', sessionId: 's1' }));

    expect(sdk.state).toBe('READY');
    expect(ready).toHaveBeenCalledWith({ protocolVersion: 1 });
    expect(authSuccess).toHaveBeenCalledWith({ userId: 'u1', sessionId: 's1' });
    sdk.destroy();
  });
});

// ── Error cases ────────────────────────────────────────────────────────────

describe('EmbedSDK — error handling', () => {
  it('transitions to ERROR on handshake timeout', () => {
    vi.useFakeTimers();
    const errorHandler = vi.fn();
    const { sdk } = makeSDK({ timeouts: { handshakeMs: 100 } });
    sdk.on('error', errorHandler);
    sdk.init();

    vi.advanceTimersByTime(200);
    expect(sdk.state).toBe('ERROR');
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HANDSHAKE_TIMEOUT', fatal: true })
    );
  });

  it('transitions to ERROR and emits auth:fail on AUTH_FAIL', async () => {
    const errorHandler = vi.fn();
    const authFail     = vi.fn();
    const { sdk, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.on('error', errorHandler);
    sdk.on('auth:fail', authFail);

    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0', negotiatedVersion: 1, capabilities: [], instanceId: 'w1',
    }));
    await flushMicrotasks(); // → AUTHENTICATING

    deliver(createEnvelope('AUTH_FAIL', { reason: 'Invalid token', code: 'AUTH_FAILED' }));

    expect(sdk.state).toBe('ERROR');
    expect(authFail).toHaveBeenCalledWith({ reason: 'Invalid token', code: 'AUTH_FAILED' });
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTH_FAILED', fatal: true })
    );
  });

  it('emits error on PROTOCOL_INCOMPATIBLE (no common version)', async () => {
    const errorHandler = vi.fn();
    const { sdk, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.on('error', errorHandler);

    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    // Widget claims to only support protocol version 99 — no overlap with parent's [1]
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '99.0.0', negotiatedVersion: 99, capabilities: [], instanceId: 'w1',
    }));
    await flushMicrotasks();

    expect(sdk.state).toBe('ERROR');
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROTOCOL_INCOMPATIBLE', fatal: true })
    );
  });
});

// ── Message queueing ───────────────────────────────────────────────────────

describe('EmbedSDK — message queueing', () => {
  it('queues open() calls before READY and flushes them after auth', async () => {
    const { sdk, sent, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.init();
    interceptSend();

    // Call open before widget is ready — should be queued
    sdk.open();
    expect(sent.filter(m => m.type === 'WIDGET_OPEN')).toHaveLength(0);

    // Drive to READY
    deliver(createEnvelope('WIDGET_READY', {}));
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0', negotiatedVersion: 1, capabilities: [], instanceId: 'w1',
    }));
    await flushMicrotasks();
    deliver(createEnvelope('AUTH_SUCCESS', {}));

    expect(sent.filter(m => m.type === 'WIDGET_OPEN').length).toBeGreaterThanOrEqual(1);
    sdk.destroy();
  });

  it('open() in READY state is sent immediately', async () => {
    const { sdk, sent, deliver, interceptSend, flushMicrotasks } = makeSDK();
    sdk.init();
    interceptSend();

    deliver(createEnvelope('WIDGET_READY', {}));
    deliver(createEnvelope('HANDSHAKE_ACK', {
      widgetVersion: '0.1.0', negotiatedVersion: 1, capabilities: [], instanceId: 'w1',
    }));
    await flushMicrotasks();
    deliver(createEnvelope('AUTH_SUCCESS', {}));
    expect(sdk.state).toBe('READY');

    const before = sent.length;
    sdk.open();
    expect(sent.length).toBeGreaterThan(before);
    expect(sent.at(-1)?.type).toBe('WIDGET_OPEN');
    sdk.destroy();
  });
});

// ── destroy ────────────────────────────────────────────────────────────────

describe('EmbedSDK — destroy', () => {
  it('removes the iframe from the DOM', () => {
    const { sdk } = makeSDK();
    sdk.init();
    expect(document.getElementById('embed-sdk-widget')).not.toBeNull();
    sdk.destroy();
    expect(document.getElementById('embed-sdk-widget')).toBeNull();
  });

  it('transitions to DESTROYED', () => {
    const { sdk } = makeSDK();
    sdk.init();
    sdk.destroy();
    expect(sdk.state).toBe('DESTROYED');
  });

  it('emits the destroy event', () => {
    const handler = vi.fn();
    const { sdk } = makeSDK();
    sdk.on('destroy', handler);
    sdk.init();
    sdk.destroy();
    expect(handler).toHaveBeenCalledOnce();
  });
});

// ── on() / events ─────────────────────────────────────────────────────────

describe('EmbedSDK — on()', () => {
  it('returns an unsubscribe function that works', () => {
    const { sdk } = makeSDK();
    const handler = vi.fn();
    const unsub = sdk.on('event', handler);
    unsub();
    sdk._transport._deliver(
      createEnvelope('PUSH_EVENT', { event: 'click', data: null }),
      ORIGIN
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits state:change on every FSM transition', () => {
    const changes: string[] = [];
    const { sdk } = makeSDK();
    sdk.on('state:change', ({ current }) => changes.push(current));
    sdk.init();
    expect(changes).toContain('MOUNTING');
    sdk.destroy();
    expect(changes).toContain('DESTROYED');
  });

  it('forwards PUSH_EVENT payload as event emission', () => {
    const handler = vi.fn();
    const { sdk, deliver } = makeSDK();
    sdk.on('event', handler);
    deliver(createEnvelope('PUSH_EVENT', { event: 'user:login', data: { id: 1 } }));
    expect(handler).toHaveBeenCalledWith({ name: 'user:login', data: { id: 1 } });
  });
});
