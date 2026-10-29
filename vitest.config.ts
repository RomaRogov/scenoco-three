import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  // Scenes are TSX with no React: the JSX runtime is core's own.
  oxc: { jsx: { runtime: 'automatic', importSource: '@scenoco-three/core' } },
  resolve: {
    // Most specific first, so `@scenoco-three/core` does not swallow its own `/jsx-runtime`.
    alias: [
      { find: '@scenoco-three/core/jsx-dev-runtime', replacement: src('core/src/jsx-dev-runtime.ts') },
      { find: '@scenoco-three/core/snapshot', replacement: src('core/src/snapshot.ts') },
      { find: '@scenoco-three/core/jsx-runtime', replacement: src('core/src/jsx-runtime.ts') },
      { find: '@scenoco-three/core', replacement: src('core/src/index.ts') },
      { find: '@scenoco-three/box2d', replacement: src('box2d/src/index.ts') },
      { find: '@scenoco-three/rapier', replacement: src('rapier/src/index.ts') },
      { find: '@scenoco-three/particles', replacement: src('particles/src/index.ts') },
      { find: '@scenoco-three/audio', replacement: src('audio/src/index.ts') },
      { find: '@scenoco-three/splines', replacement: src('splines/src/index.ts') },
      { find: '@scenoco-three/terrain', replacement: src('terrain/src/index.ts') },
      { find: '@scenoco-three/tools/vite', replacement: src('tools/src/vite.ts') },
      { find: '@scenoco-three/tools', replacement: src('tools/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'tests/.tmp/**'],
    environment: 'node',
  },
});
