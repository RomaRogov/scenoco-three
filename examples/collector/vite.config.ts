import { defineConfig } from 'vite';

// No SceNoCo plugin: a document compiles to a `.gen.ts` beside it, which is ordinary TypeScript.
// `npm run dev` is `scenoco watch -- vite` — the watcher compiles, vite serves.
export default defineConfig({
  // One `three` in the graph, or `instanceof` across two copies of it silently returns false.
  resolve: { dedupe: ['three'] },
  build: { sourcemap: true },
});
