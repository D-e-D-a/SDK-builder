import { z } from 'zod';

/**
 * Payload schemas — one per MessageType.
 *
 * These are kept separate from the envelope schema so they can be
 * validated independently when the receiver narrows on `envelope.type`.
 *
 * Pattern: narrowing guard in transport, parse payload only when known type.
 *   const env = parseEnvelope(event.data);
 *   if (env?.type === 'AUTH_REQUEST') {
 *     const p = parsePayload('AUTH_REQUEST', env.payload);
 *   }
 */

// ── Handshake ─────────────────────────────────────────────────────────────────

export const HandshakeInitPayloadSchema = z.object({
  /** Semver of the parent SDK package */
  sdkVersion: z.string(),
  /**
   * Ordered list of protocol versions the parent SDK can speak.
   * First element is the highest (preferred) version.
   */
  supportedVersions: z.array(z.number().int().positive()).min(1),
  /** Feature flags the parent supports */
  capabilities: z.array(z.string()),
  /** window.location.origin of the parent page */
  parentOrigin: z.string().min(1),
  /** Unique ID for this SDK instance (used to detect iframe reloads) */
  instanceId: z.string().min(1),
});

export const HandshakeAckPayloadSchema = z.object({
  /** Semver of the widget app */
  widgetVersion: z.string(),
  /**
   * The single negotiated protocol version — lowest common version
   * between parent's supportedVersions and widget's own support list.
   */
  negotiatedVersion: z.number().int().positive(),
  /** Feature flags the widget supports */
  capabilities: z.array(z.string()),
  /** Unique ID for this widget instance */
  instanceId: z.string().min(1),
});

// ── Auth ──────────────────────────────────────────────────────────────────────

export const AuthRequestPayloadSchema = z.object({
  /** Opaque auth token — JWT, HMAC, API key, etc. */
  token: z.string().min(1),
  /** Optional user identifier for convenience */
  userId: z.string().optional(),
  /** Any additional claims the widget needs */
  meta: z.record(z.unknown()).optional(),
});

export const AuthSuccessPayloadSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
});

export const AuthFailPayloadSchema = z.object({
  reason: z.string(),
  /** Machine-readable error code from the ErrorCode enum */
  code: z.string().optional(),
});

export const AuthRefreshPayloadSchema = z.object({
  token: z.string().min(1),
});

// ── Widget ────────────────────────────────────────────────────────────────────

export const WidgetResizePayloadSchema = z.object({
  /** CSS dimension string, e.g. "480px" or "100%" */
  width: z.string().optional(),
  height: z.string().optional(),
  /** Arbitrary CSS properties to apply to the iframe element */
  styles: z.record(z.string()).optional(),
});

// ── Events ────────────────────────────────────────────────────────────────────

export const PushEventPayloadSchema = z.object({
  /** Name of the event (namespaced by convention: "user:login") */
  event: z.string().min(1),
  data: z.unknown().optional(),
});

// ── Geometry ──────────────────────────────────────────────────────────────────

export const RequestRectPayloadSchema = z.object({
  /** Echo'd back in RECT_RESPONSE so the caller can correlate */
  correlationId: z.string().min(1),
});

export const RectResponsePayloadSchema = z.object({
  correlationId: z.string().min(1),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

// ── Typed payload map (for narrowed parsing) ──────────────────────────────────

export const PayloadSchemas = {
  HANDSHAKE_INIT: HandshakeInitPayloadSchema,
  HANDSHAKE_ACK:  HandshakeAckPayloadSchema,
  AUTH_REQUEST:   AuthRequestPayloadSchema,
  AUTH_SUCCESS:   AuthSuccessPayloadSchema,
  AUTH_FAIL:      AuthFailPayloadSchema,
  AUTH_EXPIRED:   z.object({}),       // no payload
  AUTH_REFRESH:   AuthRefreshPayloadSchema,
  WIDGET_READY:   z.object({}),       // no payload
  WIDGET_OPEN:    z.object({}),
  WIDGET_CLOSE:   z.object({}),
  WIDGET_RESIZE:  WidgetResizePayloadSchema,
  REQUEST_RECT:   RequestRectPayloadSchema,
  RECT_RESPONSE:  RectResponsePayloadSchema,
  PUSH_EVENT:     PushEventPayloadSchema,
  HEARTBEAT_PING: z.object({}),
  HEARTBEAT_PONG: z.object({}),
  SDK_DESTROY:    z.object({}),
} as const;

export type PayloadSchemas = typeof PayloadSchemas;

// ── Inferred TypeScript types (what consumers import) ─────────────────────────

export type HandshakeInitPayload = z.infer<typeof HandshakeInitPayloadSchema>;
export type HandshakeAckPayload  = z.infer<typeof HandshakeAckPayloadSchema>;
export type AuthRequestPayload   = z.infer<typeof AuthRequestPayloadSchema>;
export type AuthSuccessPayload   = z.infer<typeof AuthSuccessPayloadSchema>;
export type AuthFailPayload      = z.infer<typeof AuthFailPayloadSchema>;
export type AuthRefreshPayload   = z.infer<typeof AuthRefreshPayloadSchema>;
export type WidgetResizePayload  = z.infer<typeof WidgetResizePayloadSchema>;
export type PushEventPayload     = z.infer<typeof PushEventPayloadSchema>;
export type RequestRectPayload   = z.infer<typeof RequestRectPayloadSchema>;
export type RectResponsePayload  = z.infer<typeof RectResponsePayloadSchema>;
