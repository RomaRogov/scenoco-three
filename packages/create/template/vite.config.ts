/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

// TSX through SceNoCo's own runtime, and — while serving — the editor and what it reads and writes.
export default defineConfig({
  plugins: [scenoco()],
  // `npm test`: the game's rules in Vitest, with a document for the page's UI.
  test: { environment: 'jsdom' },
});
