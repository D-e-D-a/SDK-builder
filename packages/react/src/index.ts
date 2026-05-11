// Components
export { EmbedProvider }      from './EmbedProvider.js';
export { EmbedWidget }        from './EmbedWidget.js';

// Hooks
export { useEmbed }           from './useEmbed.js';
export { useEmbedEvent }      from './useEmbedEvent.js';

// Types
export type { EmbedProviderProps } from './EmbedProvider.js';
export type { EmbedWidgetProps }   from './EmbedWidget.js';
export type { UseEmbedResult }     from './useEmbed.js';

// Re-export the core types consumers need without requiring @embed-sdk/core directly
export type {
  SDKConfig,
  SDKEventName,
  SDKEventMap,
} from '@embed-sdk/core';
