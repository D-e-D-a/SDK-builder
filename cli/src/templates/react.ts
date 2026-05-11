import type { Config } from '../types.js';

export function generateReact(c: Config): Record<string, string> {
  const corePkg     = `${c.scope}/core`;
  const protocolPkg = `${c.scope}/protocol`;

  return {
    'packages/react/package.json': JSON.stringify(
      {
        name: `${c.scope}/react`,
        version: '0.1.0',
        type: 'module',
        exports: {
          '.': { import: './dist/index.js', types: './dist/index.d.ts' },
        },
        scripts: {
          build: 'tsup src/index.ts --format esm --dts --clean',
          dev: 'tsup src/index.ts --format esm --dts --watch',
          typecheck: 'tsc --noEmit',
        },
        dependencies: { [corePkg]: 'workspace:*' },
        peerDependencies: { react: '^18.0.0' },
        devDependencies: {
          '@types/react': '^18.3.0',
          tsup: '^8.1.0',
          typescript: '^5.5.0',
        },
      },
      null,
      2
    ),

    'packages/react/tsconfig.json': JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2
    ),

    // ── src/context.ts ────────────────────────────────────────────────────────
    'packages/react/src/context.ts': `\
import { createContext } from 'react';
import type { EmbedSDK } from '${corePkg}';

export interface EmbedContextValue {
  sdk:   EmbedSDK | null;
  state: string;
}

export const EmbedContext = createContext<EmbedContextValue | null>(null);
EmbedContext.displayName = 'EmbedContext';
`,

    // ── src/EmbedProvider.tsx ─────────────────────────────────────────────────
    'packages/react/src/EmbedProvider.tsx': `\
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { EmbedSDK } from '${corePkg}';
import type { SDKConfig } from '${corePkg}';
import { EmbedContext } from './context.js';

export interface EmbedProviderProps {
  config: SDKConfig;
  children: ReactNode;
}

export function EmbedProvider({ config, children }: EmbedProviderProps) {
  const [sdk,   setSdk]   = useState<import('${corePkg}').EmbedSDK | null>(null);
  const [state, setState] = useState<string>('IDLE');
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const instance = new EmbedSDK(configRef.current);
    const unsub = instance.on('state:change', (e) => setState(e.current));
    instance.init();
    setSdk(instance);
    setState(instance.state);

    return () => {
      unsub();
      instance.destroy();
      setSdk(null);
      setState('IDLE');
    };
  }, []);

  return (
    <EmbedContext.Provider value={{ sdk, state }}>
      {children}
    </EmbedContext.Provider>
  );
}
`,

    // ── src/useEmbed.ts ───────────────────────────────────────────────────────
    'packages/react/src/useEmbed.ts': `\
import { useContext, useCallback } from 'react';
import type { AuthRequestPayload } from '${corePkg}';
import { EmbedContext } from './context.js';

export interface UseEmbedResult {
  state:    string;
  isReady:  boolean;
  open:     () => void;
  close:    () => void;
  identify: (payload: AuthRequestPayload) => void;
}

export function useEmbed(): UseEmbedResult {
  const ctx = useContext(EmbedContext);
  if (!ctx) throw new Error('[EmbedSDK] useEmbed() must be inside <EmbedProvider>.');

  const { sdk, state } = ctx;
  const open     = useCallback(() => sdk?.open(),           [sdk]);
  const close    = useCallback(() => sdk?.close(),          [sdk]);
  const identify = useCallback((p: AuthRequestPayload) => sdk?.identify(p), [sdk]);

  return { state, isReady: state === 'READY', open, close, identify };
}
`,

    // ── src/useEmbedEvent.ts ──────────────────────────────────────────────────
    'packages/react/src/useEmbedEvent.ts': `\
import { useContext, useEffect, useRef } from 'react';
import type { SDKEventName, SDKEventMap } from '${corePkg}';
import { EmbedContext } from './context.js';

export function useEmbedEvent<K extends SDKEventName>(
  event: K,
  handler: (payload: SDKEventMap[K]) => void
): void {
  const ctx = useContext(EmbedContext);
  if (!ctx) throw new Error('[EmbedSDK] useEmbedEvent() must be inside <EmbedProvider>.');

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx.sdk) return;
    return ctx.sdk.on(event, (payload) => handlerRef.current(payload as SDKEventMap[K]));
  }, [ctx.sdk, event]);
}
`,

    // ── src/EmbedWidget.tsx ───────────────────────────────────────────────────
    'packages/react/src/EmbedWidget.tsx': `\
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { useEmbed } from './useEmbed.js';

export interface EmbedWidgetProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'> {
  children?: ReactNode;
  onClick?: () => void;
}

export function EmbedWidget({ children = 'Open', onClick, style, ...rest }: EmbedWidgetProps) {
  const { open, isReady } = useEmbed();
  return (
    <button
      {...rest}
      disabled={!isReady}
      onClick={onClick ?? open}
      aria-label={rest['aria-label'] ?? 'Open widget'}
      style={{ cursor: isReady ? 'pointer' : 'not-allowed', opacity: isReady ? 1 : 0.5, ...style }}
    >
      {children}
    </button>
  );
}
`,

    // ── src/index.ts ──────────────────────────────────────────────────────────
    'packages/react/src/index.ts': `\
export { EmbedProvider }   from './EmbedProvider.js';
export { EmbedWidget }     from './EmbedWidget.js';
export { useEmbed }        from './useEmbed.js';
export { useEmbedEvent }   from './useEmbedEvent.js';
export type { EmbedProviderProps } from './EmbedProvider.js';
export type { EmbedWidgetProps }   from './EmbedWidget.js';
export type { UseEmbedResult }     from './useEmbed.js';
export type { SDKConfig, SDKEventName, SDKEventMap } from '${corePkg}';
`,
  };
}
