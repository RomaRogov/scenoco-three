import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/vite';

// No `modules` list: the compiler reads the tag packages out of this project's package.json.
export default defineConfig({ plugins: [scenoco()] });
