/**
 * @embed-sdk/protocol
 *
 * Public API surface — deliberately minimal.
 *
 * What is exported:
 *   - Constants (PROTOCOL_VERSION, MessageType, ErrorCode)
 *   - Codec functions (createEnvelope, parseEnvelope, parsePayload, negotiateVersion)
 *   - TypeScript types for all payloads and the Envelope itself
 *
 * What is NOT exported:
 *   - Zod schemas (use the TypeScript types, not the schemas)
 *   - Internal helpers (makeId, nextSeq)
 *
 * Stability: treat every export as a public API.
 * Breaking changes require a PROTOCOL_VERSION bump and a semver major.
 */

// ── Constants ─────────────────────────────────────────────────────────────────
export { PROTOCOL_VERSION, SDK_SENTINEL, MessageType } from './constants.js';
export type { ProtocolVersion, MessageType as MessageTypeValue } from './constants.js';

// ── Errors ────────────────────────────────────────────────────────────────────
export { ErrorCode } from './errors.js';
export type { ErrorCode as ErrorCodeValue } from './errors.js';

// ── Codec (functions) ─────────────────────────────────────────────────────────
export {
  createEnvelope,
  parseEnvelope,
  parsePayload,
  negotiateVersion,
} from './codec.js';
export type { CreateEnvelopeOptions } from './codec.js';

// ── Envelope type ─────────────────────────────────────────────────────────────
export type { Envelope } from './envelope.js';

// ── Payload types ─────────────────────────────────────────────────────────────
export type {
  HandshakeInitPayload,
  HandshakeAckPayload,
  AuthRequestPayload,
  AuthSuccessPayload,
  AuthFailPayload,
  AuthRefreshPayload,
  WidgetResizePayload,
  PushEventPayload,
  RequestRectPayload,
  RectResponsePayload,
} from './messages.js';
