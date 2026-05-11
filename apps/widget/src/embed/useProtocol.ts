/**
 * useProtocol — widget-side protocol state machine.
 *
 * Manages the full handshake → auth → ready lifecycle from the widget's
 * perspective. This is the single place that touches the WidgetTransport.
 *
 * Protocol flow (widget side):
 *   mount → send WIDGET_READY
 *   ← HANDSHAKE_INIT  → send HANDSHAKE_ACK (version negotiation)
 *   ← AUTH_REQUEST    → validate token → send AUTH_SUCCESS / AUTH_FAIL
 *   ← WIDGET_OPEN     → setOpen(true)
 *   ← WIDGET_CLOSE    → setOpen(false)
 *   ← WIDGET_RESIZE   → dispatch resize event for UI to handle
 *   ← REQUEST_RECT    → send RECT_RESPONSE
 *   ← HEARTBEAT_PING  → send HEARTBEAT_PONG
 *   ← SDK_DESTROY     → clean up
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createEnvelope,
  parsePayload,
  negotiateVersion,
  PROTOCOL_VERSION,
} from '@embed-sdk/protocol';
import type {
  HandshakeInitPayload,
  AuthRequestPayload,
  RequestRectPayload,
  WidgetResizePayload,
} from '@embed-sdk/protocol';
import { WidgetTransport } from './transport.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type WidgetState =
  | 'CONNECTING'     // mounted, WIDGET_READY sent, waiting for HANDSHAKE_INIT
  | 'HANDSHAKING'    // received HANDSHAKE_INIT, ACK sent, waiting for AUTH_REQUEST
  | 'AUTHENTICATING' // received AUTH_REQUEST, validating token
  | 'READY'          // AUTH_SUCCESS sent, fully operational
  | 'ERROR';         // unrecoverable

export interface ResizeRequest {
  width?: string;
  height?: string;
  styles?: Record<string, string>;
}

export interface UseProtocolResult {
  state: WidgetState;
  isOpen: boolean;
  resize: ResizeRequest | null;
  /** Send a named event with optional payload to the parent app. */
  pushEvent: (event: string, data?: unknown) => void;
  /** Request the widget iframe to resize itself in the parent. */
  requestResize: (width?: string, height?: string, styles?: Record<string, string>) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Validates an incoming auth token.
 *
 * Replace this with your real validation logic — call your backend,
 * verify a JWT signature, check session state, etc.
 *
 * Must return { userId, sessionId } on success, or throw on failure.
 */
async function validateToken(
  _payload: AuthRequestPayload
): Promise<{ userId?: string; sessionId?: string }> {
  // Reference implementation: accept any non-empty token.
  // TODO: call your backend here to validate _payload.token
  return {
    userId:    _payload.userId ?? 'anonymous',
    sessionId: `session-${Date.now().toString(36)}`,
  };
}

export function useProtocol(parentOrigin: string): UseProtocolResult {
  const [state,  setState]  = useState<WidgetState>('CONNECTING');
  const [isOpen, setIsOpen] = useState(false);
  const [resize, setResize] = useState<ResizeRequest | null>(null);

  const transportRef      = useRef<WidgetTransport | null>(null);
  const instanceIdRef     = useRef<string>('');
  const negotiatedVersion = useRef<number>(PROTOCOL_VERSION);

  // ── pushEvent ─────────────────────────────────────────────────────────────

  const pushEvent = useCallback((event: string, data?: unknown) => {
    const t = transportRef.current;
    if (!t) return;
    t.send(createEnvelope('PUSH_EVENT', { event, data }));
  }, []);

  // ── requestResize ─────────────────────────────────────────────────────────

  const requestResize = useCallback(
    (width?: string, height?: string, styles?: Record<string, string>) => {
      const t = transportRef.current;
      if (!t) return;
      t.send(createEnvelope('WIDGET_RESIZE', { width, height, styles }));
    },
    []
  );

  // ── Main effect — attach transport, drive protocol ────────────────────────

  useEffect(() => {
    if (!parentOrigin) return;

    const transport = new WidgetTransport(parentOrigin);
    transportRef.current = transport;

    const unsub = transport.onMessage(env => {
      switch (env.type) {

        // ── Handshake ───────────────────────────────────────────────────────

        case 'HANDSHAKE_INIT': {
          const p = parsePayload('HANDSHAKE_INIT', env.payload) as HandshakeInitPayload | null;
          if (!p) return;

          const agreed = negotiateVersion(p.supportedVersions, [PROTOCOL_VERSION]);

          if (agreed === null) {
            // No common protocol version — cannot communicate
            setState('ERROR');
            transport.send(createEnvelope('HANDSHAKE_ACK', {
              widgetVersion:     __WIDGET_VERSION__,
              negotiatedVersion: -1 as unknown as number, // signal: incompatible
              capabilities:      [],
              instanceId:        p.instanceId,
            }));
            return;
          }

          negotiatedVersion.current = agreed;
          instanceIdRef.current     = `widget-${Date.now().toString(36)}`;
          setState('HANDSHAKING');

          transport.send(createEnvelope('HANDSHAKE_ACK', {
            widgetVersion:     __WIDGET_VERSION__,
            negotiatedVersion: agreed,
            capabilities:      ['auth', 'resize', 'push-event'],
            instanceId:        instanceIdRef.current,
          }));
          break;
        }

        // ── Auth ─────────────────────────────────────────────────────────────

        case 'AUTH_REQUEST': {
          const p = parsePayload('AUTH_REQUEST', env.payload) as AuthRequestPayload | null;
          if (!p) return;

          setState('AUTHENTICATING');

          validateToken(p)
            .then(result => {
              transport.send(createEnvelope('AUTH_SUCCESS', result));
              setState('READY');
            })
            .catch((err: unknown) => {
              const reason = err instanceof Error ? err.message : 'Auth validation failed';
              transport.send(createEnvelope('AUTH_FAIL', { reason, code: 'AUTH_FAILED' }));
              setState('ERROR');
            });
          break;
        }

        // ── Widget visibility ────────────────────────────────────────────────

        case 'WIDGET_OPEN':
          setIsOpen(true);
          break;

        case 'WIDGET_CLOSE':
          setIsOpen(false);
          break;

        // ── Resize ───────────────────────────────────────────────────────────

        case 'WIDGET_RESIZE': {
          const p = parsePayload('WIDGET_RESIZE', env.payload) as WidgetResizePayload | null;
          if (p) setResize({
            ...(p.width   !== undefined && { width:  p.width  }),
            ...(p.height  !== undefined && { height: p.height }),
            ...(p.styles  !== undefined && { styles: p.styles }),
          });
          break;
        }

        // ── Geometry ─────────────────────────────────────────────────────────

        case 'REQUEST_RECT': {
          const p = parsePayload('REQUEST_RECT', env.payload) as RequestRectPayload | null;
          if (!p) return;
          const r = document.documentElement.getBoundingClientRect();
          transport.send(createEnvelope('RECT_RESPONSE', {
            correlationId: p.correlationId,
            rect: { x: r.left, y: r.top, width: r.width, height: r.height },
          }));
          break;
        }

        // ── Heartbeat ────────────────────────────────────────────────────────

        case 'HEARTBEAT_PING':
          transport.send(createEnvelope('HEARTBEAT_PONG', {}));
          break;

        // ── Teardown ─────────────────────────────────────────────────────────

        case 'SDK_DESTROY':
          transport.destroy();
          transportRef.current = null;
          setState('CONNECTING');
          setIsOpen(false);
          break;
      }
    });

    // Signal readiness as soon as the listener is registered
    transport.send(createEnvelope('WIDGET_READY', {}));

    return () => {
      unsub();
      transport.destroy();
      transportRef.current = null;
    };
  }, [parentOrigin]);

  return { state, isOpen, resize, pushEvent, requestResize };
}

