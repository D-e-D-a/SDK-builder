import { z } from 'zod';

/**
 * The wire format for every message exchanged between parent and iframe.
 *
 * Field naming is intentionally short (`v` not `version`) because this
 * object is serialized on every postMessage call. Keep it lean.
 *
 * This schema is the single source of truth for the envelope shape.
 * Consumers import the TypeScript type, NOT this Zod schema directly.
 */
export const EnvelopeSchema = z.object({
  /** Namespace guard. Reject any postMessage that lacks this. */
  _sdk: z.literal(true),

  /** Protocol version agreed during handshake negotiation. */
  v: z.number().int().positive(),

  /** Unique message ID. Used for deduplication and ACK correlation. */
  id: z.string().min(1),

  /** Sender wall-clock timestamp in ms (Date.now()). */
  ts: z.number().int().positive(),

  /** Discriminant — one of the MessageType constants. */
  type: z.string().min(1),

  /**
   * When true the sender expects an ACK envelope back.
   * Absence/undefined means no ACK required (same as false).
   */
  ack: z.boolean().optional(),

  /**
   * Present only on ACK envelopes.
   * Contains the `id` of the original message being acknowledged.
   */
  ackId: z.string().optional(),

  /**
   * Monotonic send counter per session.
   * Receivers can detect out-of-order delivery if needed.
   * Wraps at 2_000_000 to avoid floating-point precision issues.
   */
  seq: z.number().int().nonnegative().optional(),

  /** Message-type-specific payload. Validated separately per type. */
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
