import { describe, it, expect, vi } from 'vitest';
import { StateMachine } from '../fsm.js';
import type { SDKState } from '../fsm.js';

function make() { return new StateMachine(); }

describe('StateMachine — initial state', () => {
  it('starts in IDLE', () => {
    expect(make().name).toBe('IDLE');
  });

  it('state is the full discriminated union object', () => {
    expect(make().state).toEqual({ name: 'IDLE' });
  });
});

describe('StateMachine — legal transitions', () => {
  it('IDLE → MOUNTING', () => {
    const fsm = make();
    expect(fsm.transition({ name: 'MOUNTING' })).toBe(true);
    expect(fsm.name).toBe('MOUNTING');
  });

  it('MOUNTING → HANDSHAKING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    const ok = fsm.transition({ name: 'HANDSHAKING', startedAt: 1 });
    expect(ok).toBe(true);
    expect(fsm.name).toBe('HANDSHAKING');
  });

  it('MOUNTING → ERROR', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    expect(fsm.transition({ name: 'ERROR', code: 'BLOCKED', message: 'x', fatal: true })).toBe(true);
    expect(fsm.name).toBe('ERROR');
  });

  it('HANDSHAKING → AUTHENTICATING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    expect(
      fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'msg-1' })
    ).toBe(true);
    expect(fsm.name).toBe('AUTHENTICATING');
  });

  it('HANDSHAKING → RECONNECTING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    expect(fsm.transition({ name: 'RECONNECTING', attempt: 1, backoffMs: 500 })).toBe(true);
  });

  it('HANDSHAKING → ERROR', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    expect(fsm.transition({ name: 'ERROR', code: 'TIMEOUT', message: 'x', fatal: true })).toBe(true);
  });

  it('AUTHENTICATING → READY', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    expect(fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 })).toBe(true);
    expect(fsm.name).toBe('READY');
  });

  it('AUTHENTICATING → RECONNECTING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    expect(fsm.transition({ name: 'RECONNECTING', attempt: 1, backoffMs: 500 })).toBe(true);
  });

  it('AUTHENTICATING → ERROR', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    expect(fsm.transition({ name: 'ERROR', code: 'AUTH_FAILED', message: 'x', fatal: true })).toBe(true);
  });

  it('READY → RECONNECTING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 });
    expect(fsm.transition({ name: 'RECONNECTING', attempt: 1, backoffMs: 500 })).toBe(true);
  });

  it('READY → DESTROYED', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 });
    expect(fsm.transition({ name: 'DESTROYED' })).toBe(true);
    expect(fsm.name).toBe('DESTROYED');
  });

  it('RECONNECTING → MOUNTING', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'RECONNECTING', attempt: 1, backoffMs: 500 });
    expect(fsm.transition({ name: 'MOUNTING' })).toBe(true);
  });

  it('ERROR → MOUNTING (recovery)', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'ERROR', code: 'X', message: 'y', fatal: true });
    expect(fsm.transition({ name: 'MOUNTING' })).toBe(true);
  });

  it('ERROR → DESTROYED', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'ERROR', code: 'X', message: 'y', fatal: true });
    expect(fsm.transition({ name: 'DESTROYED' })).toBe(true);
  });
});

describe('StateMachine — illegal transitions', () => {
  it('IDLE → HANDSHAKING is illegal', () => {
    const fsm = make();
    expect(fsm.transition({ name: 'HANDSHAKING', startedAt: 0 })).toBe(false);
    expect(fsm.name).toBe('IDLE'); // state unchanged
  });

  it('IDLE → READY is illegal', () => {
    expect(make().transition({ name: 'READY', since: 0, protocolVersion: 1 })).toBe(false);
  });

  it('IDLE → DESTROYED', () => {
    expect(make().transition({ name: 'DESTROYED' })).toBe(true);
  });

  it('IDLE → ERROR is illegal (must mount first)', () => {
    expect(make().transition({ name: 'ERROR', code: 'x', message: 'y', fatal: false })).toBe(false);
  });

  it('MOUNTING → READY is illegal (must go through handshake)', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    expect(fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 })).toBe(false);
    expect(fsm.name).toBe('MOUNTING');
  });

  it('HANDSHAKING → READY is illegal (must authenticate first)', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    expect(fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 })).toBe(false);
  });

  it('DESTROYED → anything is illegal (terminal)', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 0 });
    fsm.transition({ name: 'AUTHENTICATING', startedAt: 0, messageId: 'm' });
    fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 });
    fsm.transition({ name: 'DESTROYED' });

    const targets: SDKState[] = [
      { name: 'IDLE' },
      { name: 'MOUNTING' },
      { name: 'HANDSHAKING', startedAt: 0 },
      { name: 'READY', since: 0, protocolVersion: 1 },
    ];
    for (const t of targets) {
      expect(fsm.transition(t)).toBe(false);
      expect(fsm.name).toBe('DESTROYED');
    }
  });
});

describe('StateMachine — listeners', () => {
  it('calls listener on successful transition with prev and next', () => {
    const fsm = make();
    const handler = vi.fn();
    fsm.onTransition(handler);
    fsm.transition({ name: 'MOUNTING' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { name: 'MOUNTING' },
      { name: 'IDLE' }
    );
  });

  it('does NOT call listener on illegal transition', () => {
    const fsm = make();
    const handler = vi.fn();
    fsm.onTransition(handler);
    fsm.transition({ name: 'READY', since: 0, protocolVersion: 1 }); // illegal
    expect(handler).not.toHaveBeenCalled();
  });

  it('returned unsubscribe stops future calls', () => {
    const fsm = make();
    const handler = vi.fn();
    const unsub = fsm.onTransition(handler);
    unsub();
    fsm.transition({ name: 'MOUNTING' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple listeners are all called', () => {
    const fsm = make();
    const a = vi.fn();
    const b = vi.fn();
    fsm.onTransition(a);
    fsm.onTransition(b);
    fsm.transition({ name: 'MOUNTING' });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('listener error does not break subsequent listeners', () => {
    const fsm = make();
    const throwing = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const safe = vi.fn();
    fsm.onTransition(throwing);
    fsm.onTransition(safe);
    fsm.transition({ name: 'MOUNTING' });
    expect(safe).toHaveBeenCalledOnce();
  });
});

describe('StateMachine — is() narrowing', () => {
  it('returns true for current state name', () => {
    const fsm = make();
    expect(fsm.is('IDLE')).toBe(true);
  });

  it('returns false for non-current state name', () => {
    const fsm = make();
    expect(fsm.is('READY')).toBe(false);
  });

  it('narrows correctly after transition', () => {
    const fsm = make();
    fsm.transition({ name: 'MOUNTING' });
    fsm.transition({ name: 'HANDSHAKING', startedAt: 42 });
    expect(fsm.is('HANDSHAKING')).toBe(true);
    if (fsm.is('HANDSHAKING')) {
      expect(fsm.state.startedAt).toBe(42);
    }
  });
});
