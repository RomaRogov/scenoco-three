import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/vite';

// The plugin compiles every document under assets/ on start, and again whenever one changes.
export default defineConfig({ plugins: [scenoco()] });
