#!/usr/bin/env node
/**
 * `scenoco-editor` — the standalone editor, served from this package.
 *
 * The editor is a static site: it needs nothing from a project, and it is the same site the
 * repository publishes to GitHub Pages. This serves that site from `dist-app/` on a local port
 * and opens it, for whoever would rather not use the hosted one. There is no other mode.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('../../dist-app', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('scenoco-editor [--port <n>] [--no-open]\n\nServes the standalone editor and opens it.');
  process.exit(0);
}
const port = Number(argv[argv.indexOf('--port') + 1] || 0) || 5177;

if (!existsSync(join(site, 'index.html'))) {
  console.error('scenoco-editor: this package has no dist-app/ — run `npm run build:app` in packages/editor');
  process.exit(1);
}

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  let file = join(site, path === '/' ? 'index.html' : path);
  if (!file.startsWith(site)) {
    res.statusCode = 403;
    return res.end();
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(site, 'index.html');
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
server.listen(port, () => {
  const url = `http://localhost:${port}/`;
  console.log(`\n  editor:  ${url}\n\n  press Ctrl+C to stop\n`);
  if (!argv.includes('--no-open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
});
