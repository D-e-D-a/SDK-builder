import { describe, it, expect, vi } from 'vitest';
import { Transport } from '../transport.js';
import { createEnvelope } from '@embed-sdk/protocol';

function make() { return new Transport(); }

// ── Outbound ──────────────────────────────────────────────────────────────────

describe('Transport — send', () => {
  it('returns false when no target is attached', () => {
    const t = make();
    expect(t.send(createEnvelope('WIDGET_OPEN', {}))).toBe(false);
  });

  it('calls postMessage on the mock target', () => {
    const t = make();
    const postMessage = vi.fn();
    t._attachTarget({ postMessage }, 'https://widget.test');

    const env = createEnvelope('WIDGET_OPEN', {});
    expect(t.send(env)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(env, 'https://widget.test');
  });

  it('returns false and does not throw when target.postMessage throws', () => {
    const t = make();
    t._attachTarget({ postMessage: () => { throw new Error('blocked'); } }, '*');
    expect(() => t.send(createEnvelope('WIDGET_OPEN', {}))).not.toThrow();
    expect(t.send(createEnvelope('WIDGET_OPEN', {}))).toBe(false);
  });
});

// ── Inbound — sentinel fast-path ──────────────────────────────────────────────

describe('Transport — sentinel fast-path', () => {
  it('ignores null', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);
    t._deliver(null);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores plain strings', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);
    t._deliver('hello');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores objects without _sdk sentinel', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);
    t._deliver({ type: 'WIDGET_READY', v: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores _sdk: false', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);
    t._deliver({ _sdk: false, type: 'WIDGET_READY', v: 1, id: 'x', ts: 1, payload: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores _sdk: "true" (string, not boolean)', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);
    t._deliver({ _sdk: 'true', type: 'WIDGET_READY', v: 1, id: 'x', ts: 1, payload: {} });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Inbound — origin guard ────────────────────────────────────────────────────

describe('Transport — origin guard', () => {
  it('rejects messages from an unexpected origin', () => {
    const t = make();
    t._attachTarget({ postMessage: vi.fn() }, 'https://widget.test');
    const handler = vi.fn();
    t.onMessage(handler);

    const env = createEnvelope('WIDGET_READY', {});
    t._deliver(env, 'https://evil.com'); // wrong origin
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts messages from the expected origin', () => {
    const t = make();
    t._attachTarget({ postMessage: vi.fn() }, 'https://widget.test');
    const handler = vi.fn();
    t.onMessage(handler);

    const env = createEnvelope('WIDGET_READY', {});
    t._deliver(env, 'https://widget.test');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('accepts any origin when origin is * ', () => {
    const t = make();
    t._attachTarget({ postMessage: vi.fn() }, '*');
    const handler = vi.fn();
    t.onMessage(handler);

    t._deliver(createEnvelope('WIDGET_READY', {}), 'https://anywhere.com');
    expect(handler).toHaveBeenCalledOnce();
  });
});

// ── Inbound — deduplication ───────────────────────────────────────────────────

describe('Transport — deduplication', () => {
  it('processes a new message id exactly once', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);

    const env = createEnvelope('WIDGET_READY', {});
    t._deliver(env);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('drops a message with a seen id', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);

    const env = createEnvelope('WIDGET_READY', {});
    t._deliver(env);
    t._deliver(env); // exact same object = same id
    expect(handler).toHaveBeenCalledOnce();
  });

  it('processes two messages with different ids', () => {
    const t = make();
    const handler = vi.fn();
    t.onMessage(handler);

    t._deliver(createEnvelope('WIDGET_READY', {}));
    t._deliver(createEnvelope('WIDGET_READY', {}));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ── Handler management ────────────────────────────────────────────────────────

describe('Transport — onMessage', () => {
  it('routes valid envelopes to all registered handlers', () => {
    const t = make();
    const a = vi.fn();
    const b = vi.fn();
    t.onMessage(a);
    t.onMessage(b);
    t._deliver(createEnvelope('WIDGET_READY', {}));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('returned unsubscribe stops the handler', () => {
    const t = make();
    const handler = vi.fn();
    const unsub = t.onMessage(handler);
    unsub();
    t._deliver(createEnvelope('WIDGET_READY', {}));
    expect(handler).not.toHaveBeenCalled();
  });

  it('a throwing handler does not break subsequent handlers', () => {
    const t = make();
    t.onMessage(() => { throw new Error('boom'); });
    const safe = vi.fn();
    t.onMessage(safe);
    t._deliver(createEnvelope('WIDGET_READY', {}));
    expect(safe).toHaveBeenCalledOnce();
  });
});
