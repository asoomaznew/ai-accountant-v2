import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        fs: {
          strict: false
        },
      },
      plugins: [react(), tailwindcss()],

      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        // These packages ship pre-built ESM — Vite must NOT re-bundle them
        exclude: ['@mlc-ai/web-llm', '@xenova/transformers', 'mupdf'],
      },
      build: {
        target: 'esnext',
      },
      worker: {
        format: 'es', // Required for Comlink + WebLLM in workers
      }
    };
});

