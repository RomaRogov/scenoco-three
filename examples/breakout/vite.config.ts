import { defineConfig } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

// TSX through SceNoCo's own runtime, and — while serving — the editor and what it reads and writes.
export default defineConfig({
  // On the LAN as well as localhost: open the game on a phone or a tablet beside the computer.
  server: { host: true },
  plugins: [scenoco()],
  // The music's AudioWorklet is built as a worker: as an ES module, as a worklet must be — a classic
  // worker's build reads `self.location`, which a worklet does not have.
  worker: { format: 'es' },
});
