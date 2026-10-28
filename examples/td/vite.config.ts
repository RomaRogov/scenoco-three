import { defineConfig, type Plugin } from 'vite';
import { scenoco } from '@scenoco-three/tools/vite';

/** Development only: `src/phoneLog.ts` posts what a phone sees; it lands here as `[phone]` lines. */
const phoneLog = (): Plugin => ({
  name: 'phone-log',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__log', (req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        console.log(`[phone] ${req.socket.remoteAddress} ${body}`);
        res.statusCode = 204;
        res.end();
      });
    });
  },
});

// TSX through SceNoCo's own runtime, and — while serving — the editor and what it reads and writes.
export default defineConfig({
  // On the LAN as well as localhost: open the game on a phone or a tablet beside the computer.
  server: { host: true },
  plugins: [scenoco(), phoneLog()],
});
