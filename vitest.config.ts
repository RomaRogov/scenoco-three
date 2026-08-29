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
    // Only the ported tests; the v1 suites come back as their packages land.
    include: ['tests/core/**/*.test.ts', 'tests/compiler/**/*.test.ts', 'tests/packages/box2d.test.ts', 'tests/packages/rapier.test.ts', 'tests/packages/collision.test.ts', 'tests/packages/late-colliders.test.ts', 'tests/packages/particles.test.ts', 'tests/packages/audio.test.ts', 'tests/packages/ui.test.ts', 'tests/tooling/cli.test.ts', 'tests/tooling/editor.test.ts'],
    environment: 'node',
  },
});
