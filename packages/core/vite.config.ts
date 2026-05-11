import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Builds the IIFE bundle for runtime loading via the embed.js loader.
 * Output: dist/iife/embed-sdk-core.iife.js
 *
 * The tsup build (for ESM library use) is separate: `pnpm build:esm`
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/iife.ts'),
      name: '__EmbedSDK',
      formats: ['iife'],
      fileName: () => 'embed-sdk-core.iife.js',
    },
    outDir: 'dist/iife',
    emptyOutDir: false, // don't wipe the tsup dist/ alongside
    minify: true,
    rollupOptions: {
      // Bundle everything including @embed-sdk/protocol
      external: [],
    },
  },
  resolve: {
    // Resolve workspace packages from their source (avoids needing built dist)
    alias: [
      {
        find: '@embed-sdk/protocol',
        replacement: resolve(__dirname, '../protocol/src/index.ts'),
      },
    ],
  },
});
