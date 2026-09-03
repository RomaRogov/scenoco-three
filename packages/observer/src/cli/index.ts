#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openScenePage, type ScenePage } from '../browser.js';
import { createMcpServer, startMcpHttp, startMcpStdio } from '../mcp.js';
import { startProjectServer } from '../server.js';

const USAGE = `scenoco-observer — an agent's eyes on a SceNoCo scene, as an MCP server

Usage:
  scenoco-observer [options]

Speaks MCP on stdio, which is how an MCP client runs it:

  claude mcp add scenoco -- npx -y @scenoco-three/observer

It compiles the project, launches Chrome headless on the first tool call, opens the scene in it
and answers from it: open, outline, screenshot, telemetry, play/pause/stop, simulate. Nothing
appears on screen unless asked.

Options:
  --root <dir>       Project root (default: the nearest one at or above the current directory)
  --modules a,b      Packages whose tags the documents use, beyond three (default: the project's)
  --headed           Show the browser window, for whoever wants to watch
  --browser <path>   A browser executable, when Chrome is not installed where the OS keeps it
  --http <port>      Serve the MCP over HTTP on a fixed port instead of stdio`;

/** stdout is the MCP channel; everything a person reads goes here. */
const log = (...parts: unknown[]): void => console.error(...parts);

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    log(USAGE);
    return 0;
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const modules = flag('modules')?.split(',').filter(Boolean);
  const http = flag('http') !== undefined ? Number(flag('http')) : undefined;
  const headed = argv.includes('--headed');
  const executable = flag('browser');

  // npm and npx rewrite `cwd` to the nearest enclosing package.json when run from inside a
  // workspace package; `INIT_CWD` still holds the directory the shell was actually in.
  const from = flag('root') ?? process.env.INIT_CWD ?? process.cwd();
  const root = flag('root') ? resolve(from) : projectRootAt(from);

  const server = await startProjectServer({
    root,
    ...(modules ? { modules: ['three', ...modules] } : {}),
    quiet: http === undefined,
  });

  // The browser, once, on the first tool that needs it — and again if it went away.
  let page: Promise<ScenePage> | null = null;
  let current: string | null = null;
  const scenePage = (): Promise<ScenePage> =>
    (page ??= openScenePage(server.url, { headed, ...(executable ? { executable } : {}) }).then((opened) => ({
      async call(command) {
        // The project changed since the last call: the page's module is stale. Reopen what was
        // open, so what the agent sees is what it just wrote — or hear why it does not compile.
        if (server.changed) {
          server.settle();
          if (server.failure) throw new Error(`the project does not compile:\n${server.failure}`);
          if (current && command.type !== 'open') await opened.call({ id: '', type: 'open', path: current });
        }
        const result = await opened.call(command);
        if (command.type === 'open') current = command.path;
        return result;
      },
      close: () => opened.close(),
    })));

  let closing = false;
  let mcpClose: () => Promise<void> = async () => {};
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    const deadline = new Promise<void>((done) => setTimeout(done, 2000).unref());
    await Promise.race([
      Promise.all([mcpClose().catch(() => {}), page?.then((p) => p.close()).catch(() => {}), server.close().catch(() => {})]),
      deadline,
    ]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (http !== undefined) {
    const mcp = await startMcpHttp(() => createMcpServer(scenePage), http);
    mcpClose = () => mcp.close();
    log(`\n  mcp:  http://localhost:${http}   ← add this to your MCP client (transport: http)`);
    log(`  page: ${server.url}${headed ? '' : '   (headless; --headed to watch)'}\n\n  press Ctrl+C to stop\n`);
  } else {
    await startMcpStdio(createMcpServer(scenePage), () => void shutdown());
  }
  return new Promise<number>(() => {}); // runs until the client hangs up or Ctrl+C
}

/** The nearest directory at or above `from` that holds a `tsconfig.json`, else `from`. */
function projectRootAt(from: string): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'tsconfig.json'))) return dir;
    if (dirname(dir) === dir) return resolve(from);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    log(`scenoco-observer: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
