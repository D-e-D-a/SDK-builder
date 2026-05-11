import { EnvelopeSchema } from './envelope.js';
import { PayloadSchemas } from './messages.js';
import { PROTOCOL_VERSION, SDK_SENTINEL } from './constants.js';
import type { Envelope } from './envelope.js';
import type { MessageType } from './constants.js';
import type { PayloadSchemas as PayloadSchemasType } from './messages.js';
import type { z } from 'zod';

// ── ID generation ─────────────────────────────────────────────────────────────

let _seq = 0;

function nextSeq(): number {
  _seq = (_seq + 1) % 2_000_000;
  return _seq;
}

/**
 * Generates a short unique ID without external dependencies.
 * Format: <timestamp_base36>-<random_base36>
 * Collision probability is negligible for SDK message volumes.
 */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CreateEnvelopeOptions {
  /** When true the sender expects the receiver to send an ACK envelope back */
  ack?: boolean;
  /** Set on ACK envelopes to reference the original message id */
  ackId?: string;
  /** Override the auto-generated id (useful in tests) */
  id?: string;
  /** Override the protocol version (useful in version negotiation tests) */
  version?: number;
}

/**
 * Creates a well-formed outgoing envelope.
 *
 * This is the ONLY way to produce an envelope in the codebase.
 * Do not hand-construct envelope objects — the schema may evolve.
 */
export function createEnvelope<K extends MessageType>(
  type: K,
  payload: z.infer<PayloadSchemasType[K]>,
  options?: CreateEnvelopeOptions
): Envelope {
  return {
    [SDK_SENTINEL]: true,
    v: options?.version ?? PROTOCOL_VERSION,
    id: options?.id ?? makeId(),
    ts: Date.now(),
    type,
    ack: options?.ack,
    ackId: options?.ackId,
    seq: nextSeq(),
    payload,
  };
}

/**
 * Parses and validates an incoming postMessage event's data.
 *
 * Returns null (never throws) for:
 *   - non-SDK messages (missing _sdk sentinel)
 *   - malformed envelopes
 *   - messages that fail Zod validation
 *
 * The transport layer calls this first. Only SDK messages reach the handler.
 */
export function parseEnvelope(data: unknown): Envelope | null {
  // Fast path: reject non-objects and messages without the sentinel
  // before running the full Zod parse (avoids unnecessary schema traversal)
  if (
    data === null ||
    typeof data !== 'object' ||
    !(SDK_SENTINEL in data) ||
    (data as Record<string, unknown>)[SDK_SENTINEL] !== true
  ) {
    return null;
  }

  const result = EnvelopeSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validates the payload of a known message type against its schema.
 *
 * Usage:
 *   const env = parseEnvelope(event.data);
 *   if (env?.type === 'AUTH_REQUEST') {
 *     const payload = parsePayload('AUTH_REQUEST', env.payload);
 *     if (payload) { ... }
 *   }
 */
export function parsePayload<K extends MessageType>(
  type: K,
  payload: unknown
): z.infer<PayloadSchemasType[K]> | null {
  const schema = PayloadSchemas[type];
  if (!schema) return null;
  const result = schema.safeParse(payload);
  return result.success ? (result.data as z.infer<PayloadSchemasType[K]>) : null;
}

/**
 * Negotiates the highest mutually supported protocol version.
 * Returns null if there is no common version (PROTOCOL_INCOMPATIBLE).
 *
 * @param parentVersions  Ordered list from HANDSHAKE_INIT (highest first)
 * @param widgetVersions  Ordered list of what the widget supports
 */
export function negotiateVersion(
  parentVersions: number[],
  widgetVersions: number[]
): number | null {
  const widgetSet = new Set(widgetVersions);
  for (const v of parentVersions) {
    if (widgetSet.has(v)) return v;
  }
  return null;
}
