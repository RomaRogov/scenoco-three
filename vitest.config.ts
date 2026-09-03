import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { standardDecorators } from './packages/vite/src/decorators.js';

export default defineConfig({
  // oxc cannot lower TC39 standard decorators — it either applies the legacy
  // transform to them or emits the syntax verbatim, and both fail far from the
  // cause. This runs tsc over decorated files first. See the plugin's own notes.
  plugins: [standardDecorators()],
  resolve: {
    alias: {
      '@scenoco-three/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@scenoco-three/box2d': fileURLToPath(new URL('./packages/box2d/src/index.ts', import.meta.url)),
      '@scenoco-three/rapier': fileURLToPath(new URL('./packages/rapier/src/index.ts', import.meta.url)),
      '@scenoco-three/collision': fileURLToPath(new URL('./packages/collision/src/index.ts', import.meta.url)),
      '@scenoco-three/particles': fileURLToPath(new URL('./packages/particles/src/index.ts', import.meta.url)),
      '@scenoco-three/audio': fileURLToPath(new URL('./packages/audio/src/index.ts', import.meta.url)),
      '@scenoco-three/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Everything under tests/. This was an explicit allow-list while v1 and v2 shared the repo,
    // and it outlived that: by the end it named all 38 files individually, so adding a new test
    // file meant it silently never ran until someone noticed.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
