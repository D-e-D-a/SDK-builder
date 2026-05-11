import { describe, it, expect } from 'vitest';
import {
  HandshakeInitPayloadSchema,
  HandshakeAckPayloadSchema,
  AuthRequestPayloadSchema,
  AuthFailPayloadSchema,
  WidgetResizePayloadSchema,
  RectResponsePayloadSchema,
} from '../messages.js';

// Each schema gets a focused test: one happy path + key rejection cases.
// We do NOT exhaustively test Zod internals — that is Zod's own test suite.
// We test our SCHEMA CHOICES: which fields are required, which are optional.

describe('HandshakeInitPayloadSchema', () => {
  const valid = {
    sdkVersion: '0.1.0',
    supportedVersions: [1],
    capabilities: ['auth', 'resize'],
    parentOrigin: 'https://example.com',
    instanceId: 'inst-abc',
  };

  it('accepts valid payload', () => {
    expect(HandshakeInitPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing sdkVersion', () => {
    const { sdkVersion: _, ...rest } = valid;
    expect(HandshakeInitPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty supportedVersions array', () => {
    expect(HandshakeInitPayloadSchema.safeParse({ ...valid, supportedVersions: [] }).success).toBe(false);
  });

  it('rejects empty parentOrigin', () => {
    expect(HandshakeInitPayloadSchema.safeParse({ ...valid, parentOrigin: '' }).success).toBe(false);
  });

  it('rejects empty instanceId', () => {
    expect(HandshakeInitPayloadSchema.safeParse({ ...valid, instanceId: '' }).success).toBe(false);
  });

  it('accepts capabilities as empty array', () => {
    expect(HandshakeInitPayloadSchema.safeParse({ ...valid, capabilities: [] }).success).toBe(true);
  });
});

describe('HandshakeAckPayloadSchema', () => {
  const valid = {
    widgetVersion: '0.1.0',
    negotiatedVersion: 1,
    capabilities: ['auth'],
    instanceId: 'widget-inst-1',
  };

  it('accepts valid payload', () => {
    expect(HandshakeAckPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects negotiatedVersion of 0', () => {
    expect(HandshakeAckPayloadSchema.safeParse({ ...valid, negotiatedVersion: 0 }).success).toBe(false);
  });

  it('rejects non-integer negotiatedVersion', () => {
    expect(HandshakeAckPayloadSchema.safeParse({ ...valid, negotiatedVersion: 1.5 }).success).toBe(false);
  });
});

describe('AuthRequestPayloadSchema', () => {
  it('accepts token + userId + meta', () => {
    const result = AuthRequestPayloadSchema.safeParse({
      token: 'jwt.tok.en',
      userId: 'u1',
      meta: { plan: 'pro' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts token only (userId and meta are optional)', () => {
    expect(AuthRequestPayloadSchema.safeParse({ token: 'tok' }).success).toBe(true);
  });

  it('rejects empty token', () => {
    expect(AuthRequestPayloadSchema.safeParse({ token: '' }).success).toBe(false);
  });

  it('rejects missing token', () => {
    expect(AuthRequestPayloadSchema.safeParse({ userId: 'u1' }).success).toBe(false);
  });
});

describe('AuthFailPayloadSchema', () => {
  it('accepts reason only', () => {
    expect(AuthFailPayloadSchema.safeParse({ reason: 'Token expired' }).success).toBe(true);
  });

  it('accepts reason + code', () => {
    expect(AuthFailPayloadSchema.safeParse({ reason: 'Expired', code: 'AUTH_FAILED' }).success).toBe(true);
  });

  it('rejects missing reason', () => {
    expect(AuthFailPayloadSchema.safeParse({ code: 'AUTH_FAILED' }).success).toBe(false);
  });
});

describe('WidgetResizePayloadSchema', () => {
  it('accepts all fields optional (empty object is valid)', () => {
    expect(WidgetResizePayloadSchema.safeParse({}).success).toBe(true);
  });

  it('accepts height only', () => {
    expect(WidgetResizePayloadSchema.safeParse({ height: '480px' }).success).toBe(true);
  });

  it('accepts styles record', () => {
    const result = WidgetResizePayloadSchema.safeParse({
      styles: { height: '480px', minWidth: '320px' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.styles?.['height']).toBe('480px');
    }
  });
});

describe('RectResponsePayloadSchema', () => {
  const valid = {
    correlationId: 'corr-1',
    rect: { x: 10, y: 20, width: 400, height: 300 },
  };

  it('accepts valid rect response', () => {
    expect(RectResponsePayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing correlationId', () => {
    const { correlationId: _, ...rest } = valid;
    expect(RectResponsePayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects rect with non-numeric fields', () => {
    expect(RectResponsePayloadSchema.safeParse({
      ...valid,
      rect: { x: '10', y: 20, width: 400, height: 300 },
    }).success).toBe(false);
  });

  it('allows negative coordinates (widget can be partially off-screen)', () => {
    expect(RectResponsePayloadSchema.safeParse({
      ...valid,
      rect: { x: -5, y: -10, width: 400, height: 300 },
    }).success).toBe(true);
  });
});
