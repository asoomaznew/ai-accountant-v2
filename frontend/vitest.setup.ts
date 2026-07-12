// vitest.setup.ts
// Runs before every test file. Installs fake-indexeddb into globalThis
// so Dexie can construct AppDatabase without a real browser.

import 'fake-indexeddb/auto';

// Quiet Dexie's noisy console output during tests while still allowing
// our own [db] logger to surface.
const originalConsole = { ...console };
(globalThis as unknown as { __console: typeof console }).__console = originalConsole;
console.debug = () => {};
console.info  = (...args) => originalConsole.info('[test]', ...args);
console.warn  = (...args) => originalConsole.warn('[test]', ...args);
console.error = (...args) => originalConsole.error('[test]', ...args);