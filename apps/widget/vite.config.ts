import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],

  define: {
    // Injected into useProtocol.ts for HANDSHAKE_ACK widgetVersion field
    __WIDGET_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },

  // Multi-page: /embed is the iframe content, / is a dev sandbox
  build: {
    rollupOptions: {
      input: {
        embed: resolve(__dirname, 'embed.html'),
        main:  resolve(__dirname, 'index.html'),
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },

  resolve: {
    alias: [
      // In dev, resolve workspace packages from source for faster HMR
      {
        find: '@embed-sdk/protocol',
        replacement: resolve(__dirname, '../../packages/protocol/src/index.ts'),
      },
    ],
  },

  server: {
    port: 5174,
    // Allow the parent app (typically localhost:3000) to embed this in an iframe
    cors: true,
    headers: {
      // Remove x-frame-options so the iframe can load in dev
      'X-Frame-Options': 'ALLOWALL',
    },
  },
});
