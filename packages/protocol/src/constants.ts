/**
 * Increment this only for breaking wire-format changes.
 * Both parent SDK and widget must agree on a common version via negotiation.
 */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/**
 * Sentinel property present on every SDK envelope.
 * Lets the transport layer quickly reject unrelated postMessages
 * before running the full Zod parse.
 */
export const SDK_SENTINEL = '_sdk' as const;

/**
 * All legal message type strings that can appear in envelope.type.
 * These values cross the postMessage wire — treat them as a public API.
 * Never rename a value without a PROTOCOL_VERSION bump.
 */
export const MessageType = {
  // ── Handshake ──────────────────────────────────────────────────────────
  /** Parent → iframe: "I am alive, here are my capabilities" */
  HANDSHAKE_INIT: 'HANDSHAKE_INIT',
  /** Iframe → parent: "acknowledged, negotiated protocol version X" */
  HANDSHAKE_ACK:  'HANDSHAKE_ACK',

  // ── Auth ───────────────────────────────────────────────────────────────
  /** Parent → iframe: send auth token */
  AUTH_REQUEST: 'AUTH_REQUEST',
  /** Iframe → parent: auth accepted */
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  /** Iframe → parent: auth rejected */
  AUTH_FAIL:    'AUTH_FAIL',
  /** Iframe → parent: existing session token expired, please refresh */
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  /** Parent → iframe: here is a refreshed token */
  AUTH_REFRESH: 'AUTH_REFRESH',

  // ── Widget lifecycle ───────────────────────────────────────────────────
  /** Iframe → parent: iframe is mounted and ready for handshake */
  WIDGET_READY:  'WIDGET_READY',
  /** Parent → iframe: show the widget */
  WIDGET_OPEN:   'WIDGET_OPEN',
  /** Parent → iframe: hide the widget */
  WIDGET_CLOSE:  'WIDGET_CLOSE',
  /** Iframe → parent: adjust iframe dimensions */
  WIDGET_RESIZE: 'WIDGET_RESIZE',

  // ── Geometry ───────────────────────────────────────────────────────────
  /** Iframe → parent: request parent's bounding rect */
  REQUEST_RECT:  'REQUEST_RECT',
  /** Parent → iframe: response with bounding rect */
  RECT_RESPONSE: 'RECT_RESPONSE',

  // ── Generic events ─────────────────────────────────────────────────────
  /** Iframe → parent: named event with arbitrary data */
  PUSH_EVENT: 'PUSH_EVENT',

  // ── Heartbeat ──────────────────────────────────────────────────────────
  HEARTBEAT_PING: 'HEARTBEAT_PING',
  HEARTBEAT_PONG: 'HEARTBEAT_PONG',

  // ── Teardown ───────────────────────────────────────────────────────────
  /** Parent → iframe: SDK is being destroyed, clean up */
  SDK_DESTROY: 'SDK_DESTROY',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
