import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEnvelope,
  parseEnvelope,
  parsePayload,
  negotiateVersion,
} from '../codec.js';
import { PROTOCOL_VERSION } from '../constants.js';

// ── createEnvelope ────────────────────────────────────────────────────────────

describe('createEnvelope', () => {
  it('produces a valid envelope shape', () => {
    const env = createEnvelope('WIDGET_READY', {});

    expect(env._sdk).toBe(true);
    expect(env.v).toBe(PROTOCOL_VERSION);
    expect(env.type).toBe('WIDGET_READY');
    expect(typeof env.id).toBe('string');
    expect(env.id.length).toBeGreaterThan(0);
    expect(typeof env.ts).toBe('number');
    expect(env.ts).toBeGreaterThan(0);
    expect(typeof env.seq).toBe('number');
  });

  it('passes payload through unchanged', () => {
    const payload = { token: 'abc123', userId: 'u1' };
    const env = createEnvelope('AUTH_REQUEST', payload);
    expect(env.payload).toEqual(payload);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => createEnvelope('WIDGET_READY', {}).id)
    );
    expect(ids.size).toBe(100);
  });

  it('increments seq monotonically across calls', () => {
    const a = createEnvelope('WIDGET_READY', {});
    const b = createEnvelope('WIDGET_READY', {});
    const c = createEnvelope('WIDGET_READY', {});
    expect(b.seq!).toBeGreaterThan(a.seq!);
    expect(c.seq!).toBeGreaterThan(b.seq!);
  });

  it('sets ack: true when requested', () => {
    const env = createEnvelope('AUTH_REQUEST', { token: 't' }, { ack: true });
    expect(env.ack).toBe(true);
  });

  it('leaves ack undefined when not requested', () => {
    const env = createEnvelope('WIDGET_READY', {});
    expect(env.ack).toBeUndefined();
  });

  it('sets ackId for ACK responses', () => {
    const env = createEnvelope('WIDGET_READY', {}, { ackId: 'orig-msg-id' });
    expect(env.ackId).toBe('orig-msg-id');
  });

  it('uses a provided id override', () => {
    const env = createEnvelope('WIDGET_READY', {}, { id: 'deterministic-id' });
    expect(env.id).toBe('deterministic-id');
  });

  it('uses a provided version override', () => {
    const env = createEnvelope('WIDGET_READY', {}, { version: 99 });
    expect(env.v).toBe(99);
  });

  it('ts is close to Date.now()', () => {
    const before = Date.now();
    const env = createEnvelope('WIDGET_READY', {});
    const after = Date.now();
    expect(env.ts).toBeGreaterThanOrEqual(before);
    expect(env.ts).toBeLessThanOrEqual(after);
  });
});

// ── parseEnvelope ─────────────────────────────────────────────────────────────

describe('parseEnvelope', () => {
  it('parses a valid envelope produced by createEnvelope', () => {
    const original = createEnvelope('PUSH_EVENT', { event: 'click', data: 42 });
    const parsed = parseEnvelope(original);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('PUSH_EVENT');
    expect(parsed!._sdk).toBe(true);
    expect(parsed!.id).toBe(original.id);
  });

  // ── Sentinel rejections ───────────────────────────────────────────────────

  it('returns null for null', () => {
    expect(parseEnvelope(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseEnvelope(undefined)).toBeNull();
  });

  it('returns null for a plain string', () => {
    expect(parseEnvelope('WIDGET_READY')).toBeNull();
  });

  it('returns null for a number', () => {
    expect(parseEnvelope(42)).toBeNull();
  });

  it('returns null for an array', () => {
    expect(parseEnvelope([])).toBeNull();
  });

  it('returns null when _sdk sentinel is absent', () => {
    const data = { v: 1, id: 'x', ts: Date.now(), type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when _sdk is false', () => {
    const data = { _sdk: false, v: 1, id: 'x', ts: Date.now(), type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when _sdk is a string "true"', () => {
    const data = { _sdk: 'true', v: 1, id: 'x', ts: Date.now(), type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  // ── Schema violations ─────────────────────────────────────────────────────

  it('returns null when id is an empty string', () => {
    const data = { _sdk: true, v: 1, id: '', ts: Date.now(), type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when ts is zero', () => {
    const data = { _sdk: true, v: 1, id: 'x', ts: 0, type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when ts is negative', () => {
    const data = { _sdk: true, v: 1, id: 'x', ts: -1, type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when v is zero', () => {
    const data = { _sdk: true, v: 0, id: 'x', ts: Date.now(), type: 'WIDGET_READY', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when type is missing', () => {
    const data = { _sdk: true, v: 1, id: 'x', ts: Date.now(), payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  it('returns null when type is an empty string', () => {
    const data = { _sdk: true, v: 1, id: 'x', ts: Date.now(), type: '', payload: {} };
    expect(parseEnvelope(data)).toBeNull();
  });

  // ── Payload permissiveness ─────────────────────────────────────────────────
  // The envelope schema accepts any payload — specific types validate separately.

  it('accepts null payload', () => {
    const data = { _sdk: true, v: 1, id: 'x', ts: Date.now(), type: 'WIDGET_READY', payload: null };
    expect(parseEnvelope(data)).not.toBeNull();
  });

  it('accepts complex nested payload', () => {
    const env = createEnvelope('PUSH_EVENT', { event: 'x', data: { a: [1, 2, { b: 'c' }] } });
    const parsed = parseEnvelope(env);
    expect(parsed?.payload).toEqual(env.payload);
  });

  // ── Optional fields ────────────────────────────────────────────────────────

  it('preserves ackId when present', () => {
    const env = createEnvelope('WIDGET_READY', {}, { ackId: 'abc' });
    const parsed = parseEnvelope(env);
    expect(parsed?.ackId).toBe('abc');
  });

  it('preserves seq when present', () => {
    const env = createEnvelope('WIDGET_READY', {});
    const parsed = parseEnvelope(env);
    expect(typeof parsed?.seq).toBe('number');
  });
});

// ── parsePayload ──────────────────────────────────────────────────────────────

describe('parsePayload', () => {
  it('validates a correct AUTH_REQUEST payload', () => {
    const result = parsePayload('AUTH_REQUEST', { token: 'tok', userId: 'u1' });
    expect(result).not.toBeNull();
    expect(result!.token).toBe('tok');
  });

  it('returns null for AUTH_REQUEST with missing token', () => {
    const result = parsePayload('AUTH_REQUEST', { userId: 'u1' });
    expect(result).toBeNull();
  });

  it('returns null for AUTH_REQUEST with empty token', () => {
    const result = parsePayload('AUTH_REQUEST', { token: '' });
    expect(result).toBeNull();
  });

  it('validates a correct HANDSHAKE_INIT payload', () => {
    const payload = {
      sdkVersion: '0.1.0',
      supportedVersions: [1],
      capabilities: ['auth'],
      parentOrigin: 'https://example.com',
      instanceId: 'inst-1',
    };
    const result = parsePayload('HANDSHAKE_INIT', payload);
    expect(result).not.toBeNull();
    expect(result!.negotiatedVersion ?? result!.sdkVersion).toBeDefined();
  });

  it('returns null for HANDSHAKE_INIT with empty supportedVersions', () => {
    const result = parsePayload('HANDSHAKE_INIT', {
      sdkVersion: '1.0.0',
      supportedVersions: [],
      capabilities: [],
      parentOrigin: 'https://x.com',
      instanceId: 'i',
    });
    expect(result).toBeNull();
  });

  it('validates PUSH_EVENT payload', () => {
    const result = parsePayload('PUSH_EVENT', { event: 'user:login', data: { id: 1 } });
    expect(result).not.toBeNull();
    expect(result!.event).toBe('user:login');
  });

  it('returns null for PUSH_EVENT with empty event name', () => {
    const result = parsePayload('PUSH_EVENT', { event: '' });
    expect(result).toBeNull();
  });

  it('validates no-payload message types (WIDGET_READY)', () => {
    const result = parsePayload('WIDGET_READY', {});
    expect(result).not.toBeNull();
  });
});

// ── negotiateVersion ──────────────────────────────────────────────────────────

describe('negotiateVersion', () => {
  it('returns the highest common version', () => {
    expect(negotiateVersion([3, 2, 1], [1, 2, 3])).toBe(3);
  });

  it('returns the highest version the widget supports', () => {
    expect(negotiateVersion([3, 2, 1], [1, 2])).toBe(2);
  });

  it('returns version 1 when that is the only overlap', () => {
    expect(negotiateVersion([3, 2, 1], [1])).toBe(1);
  });

  it('returns null when there is no common version', () => {
    expect(negotiateVersion([3, 2], [1])).toBeNull();
  });

  it('returns null for empty parent versions', () => {
    expect(negotiateVersion([], [1])).toBeNull();
  });

  it('returns null for empty widget versions', () => {
    expect(negotiateVersion([1], [])).toBeNull();
  });

  it('prefers parent ordering (first match wins)', () => {
    // Parent prefers 3 > 2 > 1, widget supports 1 and 2 — should pick 2
    expect(negotiateVersion([3, 2, 1], [2, 1])).toBe(2);
  });
});
