import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';
import { singleFile } from './vite.singlefile';

// Standalone Vite config for the Subway Surfers example project.
// Run from this directory: `npm run dev` / `npm run build`
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    // Dev against the packages' live source (monorepo convenience). A real,
    // published project drops these and resolves @scenoco-three/* from node_modules.
    alias: {
      '@scenoco-three/core/internal': fileURLToPath(new URL('../../packages/core/src/internal.ts', import.meta.url)),
      '@scenoco-three/core/nodes': fileURLToPath(new URL('../../packages/core/src/nodes', import.meta.url)),
      '@scenoco-three/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@scenoco-three/compiler': fileURLToPath(new URL('../../packages/compiler/src/index.ts', import.meta.url)),
      '@scenoco-three/vite': fileURLToPath(new URL('../../packages/vite/src/index.ts', import.meta.url)),
      '@scenoco-three/collision': fileURLToPath(new URL('../../packages/collision/src/index.ts', import.meta.url)),
      '@scenoco-three/particles': fileURLToPath(new URL('../../packages/particles/src/index.ts', import.meta.url)),
      '@scenoco-three/animation': fileURLToPath(new URL('../../packages/animation/src/index.ts', import.meta.url)),
      '@scenoco-three/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../demo/subway-surfers', import.meta.url)),
    emptyOutDir: true,
  },
  // Zero-config: components are scanned from this project's assets/ folder and the
  // tag packages (collision, particles, animation) are read from its package.json.
  plugins: [bundlePlugin(), singleFile()],
});
