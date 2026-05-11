/**
 * useEmbedEvent — subscribe to a typed SDK event inside a component.
 *
 * The handler is automatically re-subscribed when the SDK instance changes
 * (e.g. after a reconnect). Handler identity changes do NOT cause
 * re-subscription — the latest handler is always called via a ref.
 *
 * Usage:
 *   useEmbedEvent('ready', ({ protocolVersion }) => {
 *     console.log('Connected, protocol v' + protocolVersion);
 *   });
 *
 *   useEmbedEvent('event', ({ name, data }) => {
 *     if (name === 'user:login') analytics.track('login', data);
 *   });
 */
import { useContext, useEffect, useRef } from 'react';
import type { SDKEventName, SDKEventMap } from '@embed-sdk/core';
import { EmbedContext } from './context.js';

export function useEmbedEvent<K extends SDKEventName>(
  event: K,
  handler: (payload: SDKEventMap[K]) => void
): void {
  const ctx = useContext(EmbedContext);
  if (!ctx) {
    throw new Error('[EmbedSDK] useEmbedEvent() must be used within an <EmbedProvider>.');
  }

  // Always call the latest handler without re-subscribing on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { sdk } = ctx;

  useEffect(() => {
    if (!sdk) return;
    // Cast: TypeScript can't narrow K through the generic `on()` overload at
    // the call site, but the runtime contract is correct — the handler receives
    // exactly SDKEventMap[K].
    return sdk.on(event, (payload) => handlerRef.current(payload as SDKEventMap[K]));
  }, [sdk, event]);
}
