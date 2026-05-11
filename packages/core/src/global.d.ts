/**
 * Minimal process declaration so `process.env.NODE_ENV` type-checks without
 * pulling in all of @types/node. Both tsup and Vite replace this at build time
 * with the literal string, so it costs nothing at runtime.
 */
declare const process: { env: { NODE_ENV?: string } };
