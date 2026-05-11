import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../events.js';

function make() { return new EventEmitter(); }

describe('EventEmitter — on / emit', () => {
  it('calls a registered handler with the correct payload', () => {
    const em = make();
    const handler = vi.fn();
    em.on('ready', handler);
    em.emit('ready', { protocolVersion: 1 });
    expect(handler).toHaveBeenCalledWith({ protocolVersion: 1 });
  });

  it('does not call a handler for a different event', () => {
    const em = make();
    const handler = vi.fn();
    em.on('ready', handler);
    em.emit('error', { code: 'X', message: 'y', fatal: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls multiple handlers for the same event', () => {
    const em = make();
    const a = vi.fn();
    const b = vi.fn();
    em.on('ready', a);
    em.on('ready', b);
    em.emit('ready', { protocolVersion: 2 });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('emitting an event with no handlers is a no-op', () => {
    expect(() => make().emit('ready', { protocolVersion: 1 })).not.toThrow();
  });
});

describe('EventEmitter — unsubscribe', () => {
  it('on() returns an unsubscribe function', () => {
    const em = make();
    const handler = vi.fn();
    const unsub = em.on('ready', handler);
    unsub();
    em.emit('ready', { protocolVersion: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off() removes a specific handler', () => {
    const em = make();
    const a = vi.fn();
    const b = vi.fn();
    em.on('ready', a);
    em.on('ready', b);
    em.off('ready', a);
    em.emit('ready', { protocolVersion: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('off() on an unregistered handler is a no-op', () => {
    const em = make();
    expect(() => em.off('ready', vi.fn())).not.toThrow();
  });

  it('calling unsub twice is safe', () => {
    const em = make();
    const unsub = em.on('ready', vi.fn());
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

describe('EventEmitter — error isolation', () => {
  it('a throwing handler does not prevent subsequent handlers from running', () => {
    const em = make();
    const bad  = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const good = vi.fn();
    em.on('ready', bad);
    em.on('ready', good);
    em.emit('ready', { protocolVersion: 1 });
    expect(good).toHaveBeenCalledOnce();
  });
});

describe('EventEmitter — removeAll', () => {
  it('removeAll() removes every handler for every event', () => {
    const em = make();
    const a = vi.fn();
    const b = vi.fn();
    em.on('ready', a);
    em.on('error', b);
    em.removeAll();
    em.emit('ready', { protocolVersion: 1 });
    em.emit('error', { code: 'X', message: 'y', fatal: false });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe('EventEmitter — typed events', () => {
  it('auth:success carries userId and sessionId', () => {
    const em = make();
    const handler = vi.fn();
    em.on('auth:success', handler);
    em.emit('auth:success', { userId: 'u1', sessionId: 's1' });
    expect(handler).toHaveBeenCalledWith({ userId: 'u1', sessionId: 's1' });
  });

  it('state:change carries previous and current', () => {
    const em = make();
    const handler = vi.fn();
    em.on('state:change', handler);
    em.emit('state:change', { previous: 'IDLE', current: 'MOUNTING' });
    expect(handler).toHaveBeenCalledWith({ previous: 'IDLE', current: 'MOUNTING' });
  });

  it('event carries name and data', () => {
    const em = make();
    const handler = vi.fn();
    em.on('event', handler);
    em.emit('event', { name: 'user:login', data: { id: 42 } });
    expect(handler).toHaveBeenCalledWith({ name: 'user:login', data: { id: 42 } });
  });
});
