import { defineConfig } from "vite";
import { resolve } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");

export default defineConfig({
  envDir: PROJECT_ROOT,
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "EmbedSDKLoader",
      formats: ["iife"],
      fileName: () => "embed.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
  },
});
