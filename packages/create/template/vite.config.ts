import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

// TSX through SceNoCo's own runtime, and — while serving — the editor and what it reads and writes.
export default defineConfig({
  plugins: [scenoco()],
});
