/**
 * The standalone editor: the same page, built as a static site.
 *
 * No dev server behind it, so the page reads documents itself — bundled examples, a folder, a
 * file, a URL — parses them with the compiler's browser entry, and builds the scene live. This
 * is what GitHub Pages hosts. `npm run build:app` writes `static/public` (the model and the
 * example documents) and then this build; `dist-app/` is the site.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./app'),
  base: './',
  publicDir: here('./static/public'),
  plugins: [react()],
  define: {
    __SCENOCO_WS_PATH__: JSON.stringify('/scenoco-ws'),
    'import.meta.env.VITE_SCENOCO_STATIC': JSON.stringify('1'),
  },
  // One `three` across the page and every tag package, or `instanceof` quietly fails.
  resolve: { dedupe: ['three'] },
  build: { outDir: here('./dist-app'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
});
