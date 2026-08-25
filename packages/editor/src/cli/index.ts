#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { startEditorServer } from '../server.js';
import { createMcpServer, startMcpHttp } from '../mcp.js';

const USAGE = `scenoco-editor — open a scene and drive it from an MCP client

Usage:
  scenoco-editor [document] [options]

With no document, the editor opens a picker listing the project's scenes and
prefabs. Tag packages are read from the project's package.json, so --modules is
only for compiling against something other than what the project depends on.

Options:
  --root <dir>     Project root (default: the nearest one at or above the
                   current directory)
  --modules a,b    Packages whose tags the documents use, beyond three
  --mcp-port <n>   Fixed MCP port (default 55470) — an MCP client is configured
                   once with a URL, so this must not move between restarts

The editor serves its own page and imports the project's generated modules, so
what you see is the same scene the game loads. Its MCP tools **observe**: open,
screenshot, telemetry, play/pause/stop, simulate. Documents are changed by
editing the XML — in the editor, or in your own editor — and the watcher rebuilds.`;

const DEFAULT_MCP_PORT = 55470;

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const document = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
  const modules = flag('modules')?.split(',').filter(Boolean);

  // npm and npx rewrite `cwd` to the nearest enclosing package.json when run from inside a
  // workspace package; `INIT_CWD` still holds the directory the shell was actually in.
  const from = flag('root') ?? process.env.INIT_CWD ?? process.cwd();
  const root = flag('root') ? resolve(from) : projectRootAt(from);

  let closing = false;
  const editor = await startEditorServer({
    root,
    ...(modules ? { modules: ['three', ...modules] } : {}),
    // Self-halt once every tab is closed, so a spawned editor never lingers holding its ports.
    onIdle: () => {
      if (closing) return;
      console.error('\n  no editor connected — shutting down so no stale process is left behind\n');
      void shutdown();
    },
  });

  const mcpPort = Number(flag('mcp-port') ?? DEFAULT_MCP_PORT);
  // A server per session: an MCP client that reconnects gets a fresh one rather than a 400.
  const mcp = await startMcpHttp(() => createMcpServer(editor.bridge, () => editor.url), mcpPort);

  const query = document ? `?path=${encodeURIComponent(document)}` : '';
  const url = `${editor.url}${query}`;
  console.log(`\n  editor:  ${url}`);
  // The address to type into a phone on the same Wi-Fi — the touch controls only mean anything
  // on a device with fingers.
  if (editor.networkUrl) console.log(`  wi-fi:   ${editor.networkUrl}${query}`);
  console.log(`  mcp:     http://localhost:${mcpPort}   ← add this to your MCP client (transport: http)`);
  console.log('\n  press Ctrl+C to stop\n');

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    // A connected browser holds WebSocket and HMR sockets open, so `close()` can stall waiting
    // for them to drain. Cap it, so Ctrl+C always exits promptly.
    const deadline = new Promise<void>((done) => setTimeout(done, 1500).unref());
    await Promise.race([
      Promise.all([mcp.close().catch(() => {}), editor.close().catch(() => {})]),
      deadline,
    ]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Having reclaimed the previous session's port, give any tab left behind by an ungraceful exit
  // a moment to reattach on its own retry loop — a restart should land in the tab that is
  // already open rather than stack a second one beside it. On a fresh port nothing is waiting.
  const reattached = editor.reusedPort && (await editor.bridge.waitForConnection(1500));
  if (reattached) {
    console.log('  reattached the editor tab already open — no new tab\n');
    // That tab is still showing whatever it had open, so a named document has to be asked for.
    if (document) await editor.bridge.send({ id: 'cli-open', type: 'open', path: document }).catch(() => {});
  } else {
    openBrowser(url);
  }
  return new Promise<number>(() => {}); // runs until interrupted
}

/**
 * The project a bare `scenoco-editor` means: the nearest directory at or above `from` that holds
 * a `tsconfig.json`.
 *
 * Running it from `src/` or `assets/scenes/` is the normal way to reach for an editor, and
 * "no tsconfig.json here" is a poor answer when the project is one directory up. Falls back to
 * `from` unchanged, so the error still names the place the person actually was.
 */
function projectRootAt(from: string): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    if (dirname(dir) === dir) return resolve(from);
  }
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
