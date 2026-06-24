import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: process.env.TAURI_DEV_HOST ?? '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.LOOPWATCH_FLUE_URL ?? 'http://127.0.0.1:3583',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
