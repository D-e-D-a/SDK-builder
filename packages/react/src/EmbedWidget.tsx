/**
 * EmbedWidget — convenience toggle trigger component.
 *
 * Renders a button that opens the widget when clicked. Automatically
 * disables itself while the SDK is not yet READY.
 *
 * This is intentionally minimal. For full control, use `useEmbed()` directly
 * and build your own trigger.
 *
 * Usage:
 *   // Custom children as the button label
 *   <EmbedWidget>
 *     <ChatIcon /> Chat with us
 *   </EmbedWidget>
 *
 *   // With a custom className
 *   <EmbedWidget className="my-chat-button" />
 *
 *   // Controlled — manage open/close yourself
 *   <EmbedWidget onClick={() => { myAnalytics.track('open'); sdk.open(); }} />
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { useEmbed } from './useEmbed.js';

export interface EmbedWidgetProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'> {
  children?: ReactNode;
  /**
   * Override the click handler. If provided, the default `sdk.open()` call
   * is NOT made — you are responsible for calling it yourself.
   */
  onClick?: () => void;
}

export function EmbedWidget({
  children = 'Open',
  onClick,
  style,
  ...rest
}: EmbedWidgetProps) {
  const { open, isReady } = useEmbed();

  return (
    <button
      {...rest}
      disabled={!isReady}
      onClick={onClick ?? open}
      aria-label={rest['aria-label'] ?? 'Open widget'}
      style={{
        // Sensible defaults — override via className or style prop
        cursor:       isReady ? 'pointer' : 'not-allowed',
        opacity:      isReady ? 1 : 0.5,
        transition:   'opacity 200ms ease',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
