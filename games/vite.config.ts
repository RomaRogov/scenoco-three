import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';

// Vite config for the games sub-workspace.
// Run: npm run games:dev   (from workspace root)
// The root is set to games/breakout so index.html is served from there.
export default defineConfig({
  root: fileURLToPath(new URL('./breakout', import.meta.url)),
  resolve: {
    alias: {
      // Mirror the workspace root aliases so games share the same source packages.
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
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../demo/breakout', import.meta.url)),
    emptyOutDir: true,
  },
  // componentRoots is relative to process.cwd() (workspace root when running npm scripts)
  plugins: [bundlePlugin({ componentRoots: ['games/breakout/components'] })],
});
