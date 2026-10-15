#!/usr/bin/env node
/**
 * `scenoco-editor [--port 5185]` — serves the editor's interface for a game's page to load.
 *
 * Start the game's own dev server as usual, run this beside it, and open the game with `?edit`:
 * the page builds the scene, holds it still, and imports the interface from here. Nothing about
 * the editor is installed in the project.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('scenoco-editor [--port <n>]\n\nServes the editor for a game page opened with ?edit (port 5185 by default).');
  process.exit(0);
}
const port = Number(argv[argv.indexOf('--port') + 1] || 0) || 5185;
const file = fileURLToPath(new URL('../dist/editor.js', import.meta.url));
if (!existsSync(file)) {
  console.error('scenoco-editor: this package has no dist/editor.js — run `npm run build` in packages/editor');
  process.exit(1);
}

createServer((req, res) => {
  // The game's page is on another port, so the module needs CORS to load at all.
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/editor.js') {
    res.statusCode = 404;
    return res.end('Open your game with ?edit — it loads /editor.js from here.');
  }
  res.setHeader('Content-Type', 'text/javascript');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`scenoco-editor: serving on http://localhost:${port}/editor.js — open your game with ?edit`);
});
