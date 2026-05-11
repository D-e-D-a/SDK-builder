import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageQueue, Priority } from '../queue.js';
import { createEnvelope } from '@embed-sdk/protocol';

function env(type = 'WIDGET_OPEN') {
  return createEnvelope(type as 'WIDGET_OPEN', {});
}

describe('MessageQueue — enqueue / flush', () => {
  it('flush returns an enqueued message', () => {
    const q = new MessageQueue();
    const e = env();
    q.enqueue(e);
    expect(q.flush()).toContain(e);
  });

  it('flush empties the queue', () => {
    const q = new MessageQueue();
    q.enqueue(env());
    q.flush();
    expect(q.size).toBe(0);
  });

  it('size reflects enqueued count', () => {
    const q = new MessageQueue();
    expect(q.size).toBe(0);
    q.enqueue(env());
    expect(q.size).toBe(1);
    q.enqueue(env());
    expect(q.size).toBe(2);
  });

  it('flush with maxPriority only drains matching items', () => {
    const q = new MessageQueue();
    const high   = env();
    const normal = env();
    const low    = env();
    q.enqueue(high,   Priority.HIGH);
    q.enqueue(normal, Priority.NORMAL);
    q.enqueue(low,    Priority.LOW);

    // Only flush CRITICAL + HIGH
    const flushed = q.flush(Priority.HIGH);
    expect(flushed).toContain(high);
    expect(flushed).not.toContain(normal);
    expect(flushed).not.toContain(low);
    expect(q.size).toBe(2); // normal + low remain
  });
});

describe('MessageQueue — priority ordering', () => {
  it('higher priority items come out first', () => {
    const q = new MessageQueue();
    const a = env(); // LOW
    const b = env(); // CRITICAL
    const c = env(); // NORMAL
    q.enqueue(a, Priority.LOW);
    q.enqueue(b, Priority.CRITICAL);
    q.enqueue(c, Priority.NORMAL);

    const out = q.flush();
    expect(out[0]).toBe(b); // CRITICAL first
    expect(out[1]).toBe(c); // NORMAL second
    expect(out[2]).toBe(a); // LOW last
  });

  it('same-priority items are FIFO', () => {
    const q = new MessageQueue();
    const first  = env();
    const second = env();
    const third  = env();
    q.enqueue(first,  Priority.NORMAL);
    q.enqueue(second, Priority.NORMAL);
    q.enqueue(third,  Priority.NORMAL);

    const out = q.flush();
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(second);
    expect(out[2]).toBe(third);
  });
});

describe('MessageQueue — TTL / expiry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('non-expired messages are flushed normally', () => {
    const q = new MessageQueue();
    const e = env();
    q.enqueue(e, Priority.NORMAL, 5_000);
    const out = q.flush();
    expect(out).toContain(e);
  });

  it('expired messages are silently discarded on flush', () => {
    const q = new MessageQueue();
    const expired = env();
    const fresh   = env();
    q.enqueue(expired, Priority.NORMAL, 1_000);
    vi.advanceTimersByTime(2_000);
    q.enqueue(fresh, Priority.NORMAL, 10_000);

    const out = q.flush();
    expect(out).not.toContain(expired);
    expect(out).toContain(fresh);
  });

  it('messages with ttlMs=0 never expire', () => {
    const q = new MessageQueue();
    const e = env();
    q.enqueue(e, Priority.NORMAL, 0); // no TTL
    vi.advanceTimersByTime(999_999_999);
    expect(q.flush()).toContain(e);
  });
});

describe('MessageQueue — trim', () => {
  it('trim keeps CRITICAL and HIGH, drops NORMAL and LOW', () => {
    const q = new MessageQueue();
    const critical = env();
    const high     = env();
    const normal   = env();
    const low      = env();
    q.enqueue(critical, Priority.CRITICAL);
    q.enqueue(high,     Priority.HIGH);
    q.enqueue(normal,   Priority.NORMAL);
    q.enqueue(low,      Priority.LOW);

    q.trim();
    const out = q.flush();
    expect(out).toContain(critical);
    expect(out).toContain(high);
    expect(out).not.toContain(normal);
    expect(out).not.toContain(low);
  });
});

describe('MessageQueue — clear', () => {
  it('clear removes all items', () => {
    const q = new MessageQueue();
    q.enqueue(env());
    q.enqueue(env());
    q.clear();
    expect(q.size).toBe(0);
    expect(q.flush()).toHaveLength(0);
  });
});
