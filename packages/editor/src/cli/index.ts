#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs, parseList } from '../args.js';
import { startEditorServer } from '../server.js';
import { startMcpServer } from '../mcp.js';

const USAGE = `scenoco-editor — open a scene/prefab and drive it from an MCP client

Usage:
  scenoco-editor <scene|prefab> [options]

Options:
  --components <dirs>  Comma-separated component dirs (default: "src")
  --packages <pkgs>    Comma-separated tag packages (e.g. @scenoco-three/box2d)
  --port <n>           Fixed editor server port (default: a free port)
  --no-open            Don't auto-open the editor in a browser

Starts a local editor (opened in your browser) and an MCP server. Point an MCP
client at the printed endpoint; its tools — open_file, get_preview, run, pause,
stop, get_telemetry — drive the live editor.`;

async function main(argv: string[]): Promise<number> {
  const { positionals, options } = parseArgs(argv);
  const file = positionals[0];
  if (file === undefined || file === '-h' || file === '--help') {
    console.log(USAGE);
    return file === undefined ? 1 : 0;
  }

  // npm/npx rewrites process.cwd() to the nearest enclosing package.json when
  // run from inside a workspace package without its own node_modules/.bin
  // (e.g. `npx scenoco-editor` from examples/breakout/scenes). INIT_CWD still
  // holds the shell's actual directory.
  const cwd = process.env.INIT_CWD || process.cwd();

  const editor = await startEditorServer({
    cwd,
    componentRoots: parseList(options.components) ?? ['src'],
    packages: parseList(options.packages) ?? [],
    ...(options.port ? { port: Number(options.port) } : {}),
  });
  const mcp = await startMcpServer(editor.bridge);

  const appUrl = `${editor.url}?file=${encodeURIComponent(resolve(cwd, file))}`;
  console.log(`\n  editor:  ${appUrl}`);
  if (editor.networkUrl) console.log(`  wi-fi:   ${editor.networkUrl}?file=${encodeURIComponent(resolve(cwd, file))}`);
  console.log(`  mcp:     ${mcp.url}   ← add this to your MCP client (transport: http)`);
  console.log(`\n  press Ctrl+C to stop\n`);

  if (!('no-open' in options)) openBrowser(appUrl);

  const shutdown = async (): Promise<void> => {
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
