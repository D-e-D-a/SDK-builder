import type { Config } from '../types.js';

export function generateProtocol(c: Config): Record<string, string> {
  const pkg = `${c.scope}/protocol`;

  return {
    // ── package manifest ──────────────────────────────────────────────────────
    'packages/protocol/package.json': JSON.stringify(
      {
        name: pkg,
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
        devDependencies: {
          tsup: '^8.1.0',
          typescript: '^5.5.0',
        },
        dependencies: {
          zod: '^3.23.0',
        },
      },
      null,
      2
    ),

    'packages/protocol/tsconfig.json': JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: { outDir: 'dist', rootDir: 'src' },
        include: ['src'],
      },
      null,
      2
    ),

    // ── src/constants.ts ──────────────────────────────────────────────────────
    'packages/protocol/src/constants.ts': `\
/** Increment when wire format changes in a breaking way */
export const PROTOCOL_VERSION = 2 as const;

export const SDK_NAMESPACE = '${c.namespace}' as const;

/** Guard property – all SDK messages carry this */
export const SDK_SENTINEL = '_sdk' as const;
`,

    // ── src/types.ts ──────────────────────────────────────────────────────────
    'packages/protocol/src/types.ts': `\
import { z } from 'zod';
import { PROTOCOL_VERSION } from './constants.js';
import {
  EnvelopeSchema,
  HandshakeInitPayloadSchema,
  HandshakeAckPayloadSchema,
  AuthRequestPayloadSchema,
  AuthSuccessPayloadSchema,
  AuthFailPayloadSchema,
  AuthRefreshPayloadSchema,
  WidgetResizePayloadSchema,
  PushEventPayloadSchema,
  RectResponsePayloadSchema,
  RequestRectPayloadSchema,
} from './schemas.js';

export type Envelope = z.infer<typeof EnvelopeSchema>;

export type MessageType =
  | 'HANDSHAKE_INIT'
  | 'HANDSHAKE_ACK'
  | 'AUTH_REQUEST'
  | 'AUTH_SUCCESS'
  | 'AUTH_FAIL'
  | 'AUTH_EXPIRED'
  | 'AUTH_REFRESH'
  | 'WIDGET_READY'
  | 'WIDGET_RESIZE'
  | 'WIDGET_OPEN'
  | 'WIDGET_CLOSE'
  | 'REQUEST_RECT'
  | 'RECT_RESPONSE'
  | 'PUSH_EVENT'
  | 'HEARTBEAT_PING'
  | 'HEARTBEAT_PONG'
  | 'SDK_DESTROY';

export type HandshakeInitPayload = z.infer<typeof HandshakeInitPayloadSchema>;
export type HandshakeAckPayload  = z.infer<typeof HandshakeAckPayloadSchema>;
export type AuthRequestPayload   = z.infer<typeof AuthRequestPayloadSchema>;
export type AuthSuccessPayload   = z.infer<typeof AuthSuccessPayloadSchema>;
export type AuthFailPayload      = z.infer<typeof AuthFailPayloadSchema>;
export type AuthRefreshPayload   = z.infer<typeof AuthRefreshPayloadSchema>;
export type WidgetResizePayload  = z.infer<typeof WidgetResizePayloadSchema>;
export type PushEventPayload     = z.infer<typeof PushEventPayloadSchema>;
export type RectResponsePayload  = z.infer<typeof RectResponsePayloadSchema>;
export type RequestRectPayload   = z.infer<typeof RequestRectPayloadSchema>;

export type { PROTOCOL_VERSION };

export type ProtocolVersion = typeof PROTOCOL_VERSION;
`,

    // ── src/schemas.ts ────────────────────────────────────────────────────────
    'packages/protocol/src/schemas.ts': `\
import { z } from 'zod';

// ─── Envelope ────────────────────────────────────────────────────────────────
export const EnvelopeSchema = z.object({
  /** Namespace guard — reject any message missing this */
  _sdk: z.literal(true),
  /** Protocol version negotiated during handshake */
  version: z.number().int().positive(),
  /** Unique message ID (nanoid) */
  id: z.string().min(1),
  /** Sender wall-clock timestamp in ms */
  ts: z.number().int().positive(),
  /** Message type discriminant */
  type: z.string(),
  /** If true the sender expects an acknowledgement envelope back */
  ack: z.boolean(),
  /** Set on ACK envelopes — echoes the original message id */
  ackId: z.string().optional(),
  /** Monotonic send sequence (for out-of-order detection) */
  seq: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});

// ─── Handshake ───────────────────────────────────────────────────────────────
export const HandshakeInitPayloadSchema = z.object({
  sdkVersion: z.string(),
  /** Ordered list of protocol versions parent supports (highest first) */
  protocolVersions: z.array(z.number().int()),
  capabilities: z.array(z.string()),
  parentOrigin: z.string(),
  instanceId: z.string(),
});

export const HandshakeAckPayloadSchema = z.object({
  widgetVersion: z.string(),
  /** Single negotiated version (lowest common between both sides) */
  protocolVersion: z.number().int(),
  capabilities: z.array(z.string()),
  instanceId: z.string(),
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const AuthRequestPayloadSchema = z.object({
  token: z.string(),
  userId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const AuthSuccessPayloadSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
});

export const AuthFailPayloadSchema = z.object({
  reason: z.string(),
  code: z.string().optional(),
});

export const AuthRefreshPayloadSchema = z.object({
  token: z.string(),
});

// ─── Widget ───────────────────────────────────────────────────────────────────
export const WidgetResizePayloadSchema = z.object({
  width: z.string().optional(),
  height: z.string().optional(),
  styles: z.record(z.string()).optional(),
});

// ─── Generic Event ────────────────────────────────────────────────────────────
export const PushEventPayloadSchema = z.object({
  event: z.string(),
  data: z.unknown().optional(),
});

// ─── Geometry ─────────────────────────────────────────────────────────────────
export const RequestRectPayloadSchema = z.object({
  correlationId: z.string(),
});

export const RectResponsePayloadSchema = z.object({
  correlationId: z.string(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});
`,

    // ── src/codec.ts ──────────────────────────────────────────────────────────
    'packages/protocol/src/codec.ts': `\
import { EnvelopeSchema } from './schemas.js';
import type { Envelope, MessageType } from './types.js';
import { PROTOCOL_VERSION } from './constants.js';

let seq = 0;
function nextSeq(): number {
  seq = (seq + 1) % 2_000_000;
  return seq;
}

/** Create a well-formed outgoing envelope */
export function createEnvelope<T>(
  type: MessageType,
  payload: T,
  options?: {
    ack?: boolean;
    ackId?: string;
    version?: number;
    id?: string;
  }
): Envelope {
  return {
    _sdk: true,
    version: options?.version ?? PROTOCOL_VERSION,
    id: options?.id ?? \`\${type}-\${Date.now()}-\${Math.random().toString(36).slice(2, 9)}\`,
    ts: Date.now(),
    type,
    ack: options?.ack ?? false,
    ackId: options?.ackId,
    seq: nextSeq(),
    payload,
  };
}

/** Parse and validate an incoming postMessage event data */
export function parseEnvelope(data: unknown): Envelope | null {
  const result = EnvelopeSchema.safeParse(data);
  if (!result.success) return null;
  return result.data;
}

/** Build an ACK response for a received envelope */
export function createAck(original: Envelope): Envelope {
  return createEnvelope('WIDGET_READY', null, {
    ack: false,
    ackId: original.id,
    id: \`ack-\${original.id}\`,
  });
}

import {
  HandshakeInitPayloadSchema,
  HandshakeAckPayloadSchema,
  AuthRequestPayloadSchema,
  AuthSuccessPayloadSchema,
  AuthFailPayloadSchema,
  AuthRefreshPayloadSchema,
  WidgetResizePayloadSchema,
  PushEventPayloadSchema,
  RequestRectPayloadSchema,
  RectResponsePayloadSchema,
} from './schemas.js';
import type { z } from 'zod';

const PayloadSchemas = {
  HANDSHAKE_INIT:  HandshakeInitPayloadSchema,
  HANDSHAKE_ACK:   HandshakeAckPayloadSchema,
  AUTH_REQUEST:    AuthRequestPayloadSchema,
  AUTH_SUCCESS:    AuthSuccessPayloadSchema,
  AUTH_FAIL:       AuthFailPayloadSchema,
  AUTH_REFRESH:    AuthRefreshPayloadSchema,
  WIDGET_RESIZE:   WidgetResizePayloadSchema,
  PUSH_EVENT:      PushEventPayloadSchema,
  REQUEST_RECT:    RequestRectPayloadSchema,
  RECT_RESPONSE:   RectResponsePayloadSchema,
} as const;

type PayloadSchemasType = typeof PayloadSchemas;

/** Parse and validate an incoming payload against its message type schema */
export function parsePayload<K extends keyof PayloadSchemasType>(
  type: K,
  payload: unknown
): z.infer<PayloadSchemasType[K]> | null {
  const schema = PayloadSchemas[type] as import('zod').ZodType | undefined;
  if (!schema) return null;
  const result = schema.safeParse(payload);
  return result.success ? (result.data as z.infer<PayloadSchemasType[K]>) : null;
}
`,

    // ── src/index.ts ──────────────────────────────────────────────────────────
    'packages/protocol/src/index.ts': `\
export { PROTOCOL_VERSION, SDK_NAMESPACE, SDK_SENTINEL } from './constants.js';
export { createEnvelope, parseEnvelope, createAck, parsePayload } from './codec.js';
export {
  EnvelopeSchema,
  HandshakeInitPayloadSchema,
  HandshakeAckPayloadSchema,
  AuthRequestPayloadSchema,
  AuthSuccessPayloadSchema,
  AuthFailPayloadSchema,
  AuthRefreshPayloadSchema,
  WidgetResizePayloadSchema,
  PushEventPayloadSchema,
  RectResponsePayloadSchema,
  RequestRectPayloadSchema,
} from './schemas.js';
export type {
  Envelope,
  MessageType,
  HandshakeInitPayload,
  HandshakeAckPayload,
  AuthRequestPayload,
  AuthSuccessPayload,
  AuthFailPayload,
  AuthRefreshPayload,
  WidgetResizePayload,
  PushEventPayload,
  RectResponsePayload,
  RequestRectPayload,
  ProtocolVersion,
} from './types.js';
`,
  };
}
