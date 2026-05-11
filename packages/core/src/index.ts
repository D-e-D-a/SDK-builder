/**
 * @embed-sdk/core — public API surface.
 *
 * Only EmbedSDK and its config/event types are exported.
 * Everything else (StateMachine, Transport, MessageQueue, EventEmitter)
 * is an internal implementation detail and must NOT be imported by consumers.
 */
export { EmbedSDK } from './sdk.js';
export type { SDKConfig } from './sdk.js';
export type { SDKEventMap, SDKEventName } from './events.js';
export type { SDKState, SDKStateName } from './fsm.js';
export { Priority } from './queue.js';
// Re-export the protocol payload types that consumers need at the SDK boundary
export type { AuthRequestPayload } from '@embed-sdk/protocol';
