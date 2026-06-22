import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';
import { singleFile } from './vite.singlefile';

// Vite config for the examples sub-workspace.
// Run: npm run examples:dev   (from workspace root)
// The root is set to examples/breakout so index.html is served from there.
export default defineConfig({
  root: fileURLToPath(new URL('./breakout', import.meta.url)),
  resolve: {
    alias: {
      // Mirror the workspace root aliases so examples share the same source packages.
      '@scenoco-three/core/internal': fileURLToPath(
        new URL('../packages/core/src/internal.ts', import.meta.url),
      ),
      '@scenoco-three/core/nodes': fileURLToPath(
        new URL('../packages/core/src/nodes', import.meta.url),
      ),
      '@scenoco-three/core': fileURLToPath(
        new URL('../packages/core/src/index.ts', import.meta.url),
      ),
      '@scenoco-three/compiler': fileURLToPath(
        new URL('../packages/compiler/src/index.ts', import.meta.url),
      ),
      '@scenoco-three/vite': fileURLToPath(
        new URL('../packages/vite/src/index.ts', import.meta.url),
      ),
      '@scenoco-three/box2d': fileURLToPath(
        new URL('../packages/box2d/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../demo/breakout', import.meta.url)),
    emptyOutDir: true,
  },
  // componentRoots is relative to process.cwd() (workspace root when running npm scripts).
  // registerPackages makes the box2d tags (RigidBody2D/Collider2D/Physics2D) known to
  // the compiler so the scene validates and compiles.
  plugins: [
    bundlePlugin({
      componentRoots: ['examples/breakout/components'],
      registerPackages: ['@scenoco-three/box2d'],
    }),
    // `npm run examples:build` packages everything into one self-contained
    // demo/breakout/index.html (inlined JS/CSS) that runs from file://.
    singleFile(),
  ],
});
