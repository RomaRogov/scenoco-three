/**
 * The game the observer looks at: the project's own Vite dev server, and a headless Chrome on the
 * GPU it owns. Nothing appears on screen; `--headed` shows the window.
 *
 * The page answers through `window.__behaviours`, which `play()` installs in development.
 * A page without it — a game that does not use SceNoCo — still gets pictures, input and `eval`,
 * and is told plainly which tools need it.
 */
import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, loadConfigFromFile, type ViteDevServer } from 'vite';

export interface ConsoleEntry {
  seq: number;
  level: 'error' | 'warning' | 'info' | 'log' | 'debug';
  text: string;
}

export const FRAME = { width: 960, height: 640 };

/** The dependency optimizer re-bundled under a loaded page: its module URLs are gone, and a reload cures it. */
/** Warnings the libraries print on every load. Not the game's, and a model would chase them. */
const DEPENDENCY_NOISE = [
  /using deprecated parameters for the initialization function/, // Rapier's wasm init
  /THREE\.Clock: This module has been deprecated/, // R3F's own clock
  /Download the React DevTools/,
  /^\[vite\] (connecting|connected)/, // the dev client's handshake
];

const STALE_MODULE = /Failed to fetch dynamically imported module|Outdated Optimize Dep|error loading dynamically imported module/i;

export interface GameOptions {
  root: string;
  headed?: boolean;
}

export interface Game {
  readonly page: Page;
  /** Run a method of the page's bridge. Throws with the page's own message. */
  bridge<T>(method: string, ...args: unknown[]): Promise<T>;
  readonly hasBridge: boolean;
  /** Reload when a source file changed since the last call; says so when it did. */
  freshen(): Promise<string | null>;
  reload(): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  consoleSince(seq: number): ConsoleEntry[];
  readonly consoleSeq: number;
  close(): Promise<void>;
}

export async function openGame(options: GameOptions): Promise<Game> {
  const root = resolve(options.root);
  // Quiet, because stdout is the MCP channel; no hot reload, because the observer reloads on
  // purpose when a file changes, and a reload of its own mid-call would lose the held clock.
  // Vite resolves a config's relative `root` ('app') against the process's directory, not the
  // project's: launched from elsewhere it would serve some other folder. Resolve it here instead.
  const configFile = resolve(root, 'vite.config.ts');
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, root, 'silent');
  const server: ViteDevServer = await createServer({
    configFile,
    root: resolve(root, loaded?.config.root ?? '.'),
    logLevel: 'silent',
    clearScreen: false,
    server: { port: 0, hmr: false },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('the Vite dev server started without a local URL');

  let browser: Browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: !options.headed,
      // The GPU, explicitly: some headless builds otherwise fall back to a software rasterizer.
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    });
  } catch (error) {
    await server.close();
    throw new Error(`could not launch Chrome — install Google Chrome.\n${error instanceof Error ? error.message : String(error)}`);
  }
  const page = await browser.newPage({ viewport: { ...FRAME }, deviceScaleFactor: 1 });

  // The page's own words. A framework that reports a mistake on the console has told nobody unless
  // someone reads it, so every reply carries what is new.
  const log: ConsoleEntry[] = [];
  let seq = 0;
  const record = (level: ConsoleEntry['level'], text: string) => {
    if (DEPENDENCY_NOISE.some((r) => r.test(text))) return;
    log.push({ seq: ++seq, level, text });
    if (log.length > 500) log.splice(0, log.length - 500);
  };
  page.on('console', (m) => {
    const t = m.type();
    record(t === 'error' ? 'error' : t === 'warning' ? 'warning' : t === 'info' ? 'info' : t === 'debug' ? 'debug' : 'log', m.text());
  });
  page.on('pageerror', (e) => record('error', String(e)));

  let hasBridge = false;
  const load = async (reload: boolean) => {
    const from = seq;
    if (reload) await page.reload({ waitUntil: 'commit' });
    else await page.goto(url, { waitUntil: 'commit' });
    await page.waitForSelector('canvas', { timeout: 20_000 }).catch(() => record('error', 'observer: no <canvas> appeared within 20 s'));
    hasBridge = await page
      .waitForFunction(() => '__behaviours' in window, undefined, { timeout: 3000 })
      .then(() => true, () => false);
    // Behaviours wake on the first frames and attach their input listeners then: a key pressed
    // before that goes nowhere. Wait until the game has run a few frames.
    if (hasBridge) {
      await page
        .waitForFunction(() => (window as unknown as { __behaviours: { clock(): { frame: number } } }).__behaviours.clock().frame >= 3, undefined, { timeout: 5000 })
        .catch(() => {});
    } else {
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
    }
    return log.some((e) => e.seq > from && STALE_MODULE.test(e.text));
  };
  if (await load(false)) await load(true);

  // A change on disk means the page is running old code: reload before the next answer.
  let changed: string | null = null;
  const watchers: FSWatcher[] = [];
  for (const dir of ['app', 'src']) {
    try {
      watchers.push(
        watch(resolve(root, dir), { recursive: true }, (_, file) => {
          if (file && !/(^|\/)(shots|node_modules)\//.test(String(file))) changed = `${dir}/${file}`;
        }),
      );
    } catch {
      // a project without that folder
    }
  }

  const game: Game = {
    page,
    get hasBridge() {
      return hasBridge;
    },
    async bridge<T>(method: string, ...args: unknown[]): Promise<T> {
      if (!hasBridge) {
        throw new Error(
          `\`${method}\` reads the game through the bridge play() installs, and this page has none in development. ` +
            'Screenshots, input, `wait` and `eval` still work.',
        );
      }
      try {
        return (await page.evaluate(
          async ([m, a]) => {
            const b = (window as unknown as { __behaviours: Record<string, (...x: unknown[]) => unknown> }).__behaviours;
            return (await b[m]!(...a)) as never;
          },
          [method, args] as const,
        )) as T;
      } catch (error) {
        // The page's message, without Playwright's wrapper or the bridge's stack.
        const text = (error instanceof Error ? error.message : String(error)).replace(/^page\.evaluate: (Error: )?/, '');
        throw new Error(text.split('\n    at ')[0]);
      }
    },
    async freshen() {
      if (!changed) return null;
      const file = changed;
      changed = null;
      if (await load(true)) await load(true);
      return `Reloaded the game: ${file} changed. The clock runs in real time again.`;
    },
    async reload() {
      changed = null;
      if (await load(true)) await load(true);
    },
    async resize(width, height) {
      const now = page.viewportSize();
      if (now?.width !== width || now?.height !== height) await page.setViewportSize({ width, height });
    },
    consoleSince: (after) => log.filter((e) => e.seq > after),
    get consoleSeq() {
      return seq;
    },
    async close() {
      for (const w of watchers) w.close();
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
  return game;
}
