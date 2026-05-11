import type { Config } from '../types.js';

export function generateExample(c: Config): Record<string, string> {
  const corePkg   = `${c.scope}/core`;
  const reactPkg  = `${c.scope}/react`;

  return {
    'apps/example/package.json': JSON.stringify(
      {
        name: `${c.scope}/example`,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc --noEmit && vite build',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          [reactPkg]: 'workspace:*',
          [corePkg]:  'workspace:*',
          react: '^18.3.0',
          'react-dom': '^18.3.0',
        },
        devDependencies: {
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          '@vitejs/plugin-react': '^4.3.0',
          typescript: '^5.5.0',
          vite: '^5.3.0',
        },
      },
      null,
      2
    ),

    'apps/example/tsconfig.json': JSON.stringify(
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

    'apps/example/vite.config.ts': `\
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
});
`,

    'apps/example/index.html': `\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${c.name} — Example</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

    'apps/example/src/main.tsx': `\
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,

    'apps/example/src/App.tsx': `\
import { useMemo } from 'react';
import { EmbedProvider, EmbedWidget, useEmbedEvent } from '${reactPkg}';

// ── Widget event listener (example) ──────────────────────────────────────────
function WidgetEvents() {
  useEmbedEvent('ready', ({ protocolVersion }) => {
    console.log('[Example] Widget ready, protocol v' + protocolVersion);
  });
  useEmbedEvent('event', ({ name, data }) => {
    console.log('[Example] Widget event:', name, data);
  });
  useEmbedEvent('auth:success', ({ userId }) => {
    console.log('[Example] Authenticated as:', userId);
  });
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────
export function App() {
  const config = useMemo(() => ({
    widgetOrigin: '${c.widgetOrigin}',
    widgetUrl:    '${c.widgetOrigin}/embed',
    // TODO: replace with your real token endpoint
    getToken: () => fetch('/api/embed-token').then(r => r.json()),
  }), []);

  return (
    <EmbedProvider config={config}>
      <WidgetEvents />

      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>${c.name} Example</h1>
        <p style={{ color: '#555', marginBottom: '1.5rem' }}>
          Click the button to open the widget. Open the console to see events.
        </p>
        <EmbedWidget style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', borderRadius: '8px' }}>
          Open widget
        </EmbedWidget>
      </div>
    </EmbedProvider>
  );
}
`,
  };
}
