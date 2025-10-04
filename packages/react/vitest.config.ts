import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  resolve: {
    alias: [
      { find: '@ua2/core', replacement: path.join(coreSrc, 'index.ts') },
      { find: '@ua2/core/', replacement: `${coreSrc}/` },
    ],
  },
});
