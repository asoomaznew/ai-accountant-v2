// vitest.config.ts
// Test runner configuration for the frontend.
//
// - Uses jsdom so Dexie/IndexedDB code that touches DOM globals has a host.
// - Sets up fake-indexeddb BEFORE module import via the `setupFiles` hook
//   so db/database.ts can construct `new AppDatabase()` in tests.
// - Picks up `*.test.ts` and `*.test.tsx` anywhere in the repo (rooted here).
// - Adds `@/` path alias to match tsconfig.json so tests can use the same imports as app code.

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    // Dexie only needs IndexedDB; `node` env is enough and avoids a heavy
    // jsdom dep. fake-indexeddb (loaded by setupFiles) installs IndexedDB
    // into globalThis automatically.
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});