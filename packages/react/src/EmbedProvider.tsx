/**
 * EmbedProvider
 *
 * Creates an EmbedSDK instance, calls init(), and provides it to the tree
 * via EmbedContext. Only one provider should exist per application.
 *
 * React Strict Mode (dev) double-invokes effects: the provider creates one SDK
 * instance, destroys it in the cleanup, then creates a fresh one. This is
 * intentional — both instances are short-lived in dev; only the second survives.
 * In production there is no double-invoke.
 *
 * Config stability: pass a stable reference (useMemo / module-level const) for
 * `getToken` and other function props. The effect captures config via a ref so
 * it never re-runs due to inline object/function identity changes.
 *
 * Usage:
 *   const config = useMemo(() => ({
 *     widgetOrigin: 'https://widget.example.com',
 *     widgetUrl:    'https://widget.example.com/embed',
 *     getToken:     () => fetch('/api/token').then(r => r.json()),
 *   }), []);
 *
 *   <EmbedProvider config={config}>
 *     <App />
 *   </EmbedProvider>
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { EmbedSDK } from '@embed-sdk/core';
import type { SDKConfig } from '@embed-sdk/core';
import { EmbedContext } from './context.js';

export interface EmbedProviderProps {
  config: SDKConfig;
  children: ReactNode;
}

export function EmbedProvider({ config, children }: EmbedProviderProps) {
  const [sdk,   setSdk]   = useState<EmbedSDK | null>(null);
  const [state, setState] = useState<string>('IDLE');

  // Capture config in a ref so the effect dep-array stays empty.
  // Changes to config after mount are intentionally ignored — the SDK is a
  // singleton and re-initialising mid-session would disrupt active sessions.
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const instance = new EmbedSDK(configRef.current);

    // Mirror FSM state into React state for consumers
    const unsub = instance.on('state:change', (e) => {
      setState(e.current);
    });

    instance.init();
    setSdk(instance);
    setState(instance.state);

    return () => {
      unsub();
      instance.destroy();
      setSdk(null);
      setState('IDLE');
    };
  }, []); // intentionally empty — config is captured via configRef

  return (
    <EmbedContext.Provider value={{ sdk, state }}>
      {children}
    </EmbedContext.Provider>
  );
}
