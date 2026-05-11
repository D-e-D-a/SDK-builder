import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Reads .env files from the workspace/project root (two levels up from packages/loader/).
 * In a generated project, the root contains .env.development and .env.production.
 *
 * Override envDir here if your project structure differs.
 */
const PROJECT_ROOT = resolve(__dirname, '../..');

export default defineConfig({
  // Load .env files from the project root, not from packages/loader/
  envDir: PROJECT_ROOT,

  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'EmbedSDKLoader',
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      external: [],
    },
  },
});
