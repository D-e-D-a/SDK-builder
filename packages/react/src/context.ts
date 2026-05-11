import { createContext } from 'react';
import type { EmbedSDK } from '@embed-sdk/core';

export interface EmbedContextValue {
  /** The active SDK instance. Null while the effect is mounting or after destroy. */
  sdk:   EmbedSDK | null;
  /** Current FSM state name — re-renders consumers on every transition. */
  state: string;
}

export const EmbedContext = createContext<EmbedContextValue | null>(null);
EmbedContext.displayName = 'EmbedContext';
