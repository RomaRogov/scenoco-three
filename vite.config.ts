import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { bundlePlugin } from '@scenoco-three/vite';
import { singleFile } from './vite.singlefile';

// The playground is both the dev sandbox and the demo app. `npm run dev` serves
// it; `npm run build:demo` packages it into a single self-contained HTML file.
// Scenes are compiled to bundles in Node (bundlePlugin) so the browser ships no XML parser.
export default defineConfig({
  root: 'playground',
  resolve: {
    alias: {
      // More specific subpaths first (prefix-matched).
      '@scenoco-three/core/internal': fileURLToPath(new URL('./packages/core/src/internal.ts', import.meta.url)),
      '@scenoco-three/core/nodes': fileURLToPath(new URL('./packages/core/src/nodes', import.meta.url)),
      '@scenoco-three/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@scenoco-three/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
      '@scenoco-three/vite': fileURLToPath(new URL('./packages/vite/src/index.ts', import.meta.url)),
      '@scenoco-three/rapier': fileURLToPath(new URL('./packages/rapier/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./demo', import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [bundlePlugin({ componentRoots: ['playground/components'] }), singleFile()],
});
