/**
 * Canonical error codes for the SDK.
 *
 * These appear in:
 *   - AuthFailPayload.code
 *   - SDK error events
 *   - Internal FSM error states
 *
 * They are strings (not numbers) so they are self-describing in logs
 * and don't require a lookup table to interpret.
 */
export const ErrorCode = {
  // ── Transport ────────────────────────────────────────────────────────────
  /** Iframe failed to load (blocked by CSP, adblock, or network) */
  IFRAME_BLOCKED: 'IFRAME_BLOCKED',
  /** Iframe did not fire onload within the configured timeout */
  IFRAME_LOAD_TIMEOUT: 'IFRAME_LOAD_TIMEOUT',
  /** postMessage arrived from an unexpected origin */
  ORIGIN_MISMATCH: 'ORIGIN_MISMATCH',

  // ── Handshake ────────────────────────────────────────────────────────────
  /** Widget did not complete handshake within the configured timeout */
  HANDSHAKE_TIMEOUT: 'HANDSHAKE_TIMEOUT',
  /** No protocol version overlap between parent and widget */
  PROTOCOL_INCOMPATIBLE: 'PROTOCOL_INCOMPATIBLE',

  // ── Auth ─────────────────────────────────────────────────────────────────
  /** Widget rejected the auth token */
  AUTH_FAILED: 'AUTH_FAILED',
  /** getToken() threw or rejected */
  AUTH_RESOLVE_FAILED: 'AUTH_RESOLVE_FAILED',
  /** Widget did not respond to AUTH_REQUEST within the timeout */
  AUTH_TIMEOUT: 'AUTH_TIMEOUT',

  // ── Generic ──────────────────────────────────────────────────────────────
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
