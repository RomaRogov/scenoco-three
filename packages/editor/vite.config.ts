import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One ES module with nothing external: the game's page imports it by URL, so it can carry no bare
// imports. React is bundled in; three.js and the scene come from the page, through `EditHost`.
export default defineConfig({
  plugins: [react()],
  // A library build leaves `process.env.NODE_ENV` for a bundler that never comes: say it here.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: 'src/main.tsx', formats: ['es'], fileName: () => 'editor.js' },
    target: 'es2022',
  },
});
