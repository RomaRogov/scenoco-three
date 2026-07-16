#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs, parseList } from '../args.js';
import { startEditorServer } from '../server.js';
import { startMcpServer } from '../mcp.js';

const USAGE = `scenoco-editor — open a scene/prefab and drive it from an MCP client

Usage:
  scenoco-editor [scene|prefab] [--port <n>] [--no-open]

With no file, the editor opens a picker listing the scenes/prefabs in the
project's assets/ folder. Components are scanned from that assets/ folder and tag
packages are read from its package.json — no --components/--packages needed.

Options:
  --port <n>   Fixed MCP server port — set this so the endpoint an MCP client
               connects to is stable across restarts (the editor's own HTTP
               server always takes a free port; it doesn't need to be fixed)
  --no-open    Don't auto-open the editor in a browser

Starts a local editor and an MCP server. The editor opens in your default
browser; when you stop the server (Ctrl+C) it tells the page to close its own
tab, so no stale tab is left behind. Point an MCP client at the printed
endpoint; its tools — open_file, get_preview, playback, simulate, get_telemetry,
edit_scene, save_file — drive the live editor.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, options } = parseArgs(argv);
  const file = positionals[0];
  if (file === '-h' || file === '--help') {
    console.log(USAGE);
    return 0;
  }

  // npm/npx rewrites process.cwd() to the nearest enclosing package.json when
  // run from inside a workspace package without its own node_modules/.bin
  // (e.g. `npx scenoco-editor` from examples/breakout/scenes). INIT_CWD still
  // holds the shell's actual directory.
  const cwd = process.env.INIT_CWD || process.cwd();

  // Components default to assets/ and tag packages to the project's package.json
  // deps (see startEditorServer); --components/--packages remain as optional
  // overrides for non-standard layouts.
  // The editor's HTTP server can float on any free port — the browser is pointed
  // at whatever it gets. `--port` fixes the MCP endpoint instead, so an MCP
  // client's configured URL stays valid across editor restarts.
  const editor = await startEditorServer({
    cwd,
    ...(parseList(options.components) ? { componentRoots: parseList(options.components) } : {}),
    ...(parseList(options.packages) ? { packages: parseList(options.packages) } : {}),
  });
  const mcp = await startMcpServer(editor.bridge, {
    ...(options.port ? { port: Number(options.port) } : {}),
  });

  // With no file, open bare — the editor page shows a picker of the assets/ scenes.
  const query = file ? `?file=${encodeURIComponent(resolve(cwd, file))}` : '';
  const appUrl = `${editor.url}${query}`;
  console.log(`\n  editor:  ${appUrl}`);
  if (editor.networkUrl) console.log(`  wi-fi:   ${editor.networkUrl}${query}`);
  console.log(`  mcp:     ${mcp.url}   ← add this to your MCP client (transport: http)`);
  console.log(`\n  press Ctrl+C to stop\n`);

  if (!('no-open' in options)) openBrowser(appUrl);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    // Tell the editor page to close its own tab, then give the notification a
    // moment to reach the browser before we tear the socket down. Works in any
    // browser/OS (the tab was opened with the platform's default `open`), though
    // window.close() is best-effort — see the app's wsClient for the fallback.
    editor.bridge.push({ push: 'shutdown' });
    await new Promise((r) => setTimeout(r, 250).unref());
    // Connected browsers keep WS/HMR/keep-alive sockets open, so `close()` can
    // stall waiting for them to drain — cap it so Ctrl+C always exits promptly.
    const deadline = new Promise<void>((r) => setTimeout(r, 1500).unref());
    await Promise.race([Promise.all([mcp.close().catch(() => {}), editor.close().catch(() => {})]), deadline]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await new Promise(() => {}); // keep alive
  return 0;
}

/** Open a URL in the default browser (best-effort, per platform). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* non-fatal: the URL is printed */
  }
}

process.exitCode = await main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  return 1;
});
