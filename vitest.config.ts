import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // More specific subpaths first (prefix-matched).
      '@scenoco-three/core/internal': fileURLToPath(new URL('./packages/core/src/internal.ts', import.meta.url)),
      '@scenoco-three/core/nodes': fileURLToPath(new URL('./packages/core/src/nodes', import.meta.url)),
      '@scenoco-three/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@scenoco-three/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
      '@scenoco-three/vite': fileURLToPath(new URL('./packages/vite/src/index.ts', import.meta.url)),
      '@scenoco-three/rapier': fileURLToPath(new URL('./packages/rapier/src/index.ts', import.meta.url)),
      '@scenoco-three/box2d': fileURLToPath(new URL('./packages/box2d/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
