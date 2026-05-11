/**
 * useEmbed — primary hook for interacting with the embed SDK.
 *
 * Must be called within an EmbedProvider tree.
 *
 * Returns a stable API object: `open`, `close`, and `identify` are
 * referentially stable callbacks (safe as useEffect / useCallback deps).
 *
 * Usage:
 *   function OpenButton() {
 *     const { open, state } = useEmbed();
 *     return (
 *       <button onClick={open} disabled={state !== 'READY'}>
 *         Open
 *       </button>
 *     );
 *   }
 */
import { useContext, useCallback } from 'react';
import type { AuthRequestPayload } from '@embed-sdk/core';
import { EmbedContext } from './context.js';

export interface UseEmbedResult {
  /** Current FSM state name. Re-renders this component on every state change. */
  state: string;
  /** True when the SDK is fully authenticated and ready to accept commands. */
  isReady: boolean;
  /** Tell the widget to show itself. No-op if SDK is not ready — enqueued internally. */
  open: () => void;
  /** Tell the widget to hide itself. No-op if SDK is not ready — enqueued internally. */
  close: () => void;
  /**
   * Re-authenticate with a new token / user identity.
   * Safe to call at any time — enqueued internally if not yet READY.
   */
  identify: (payload: AuthRequestPayload) => void;
}

export function useEmbed(): UseEmbedResult {
  const ctx = useContext(EmbedContext);
  if (!ctx) {
    throw new Error('[EmbedSDK] useEmbed() must be used within an <EmbedProvider>.');
  }

  const { sdk, state } = ctx;

  const open = useCallback(() => {
    sdk?.open();
  }, [sdk]);

  const close = useCallback(() => {
    sdk?.close();
  }, [sdk]);

  const identify = useCallback((payload: AuthRequestPayload) => {
    sdk?.identify(payload);
  }, [sdk]);

  return {
    state,
    isReady: state === 'READY',
    open,
    close,
    identify,
  };
}
