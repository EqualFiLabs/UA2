import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ua2/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@ua2/react': fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
