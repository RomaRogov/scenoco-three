/**
 * The browser the observer owns.
 *
 * A scene has to be rendered by a real GPU-backed browser — three.js draws through WebGL2, and
 * Node has none — so the observer launches Chrome itself and asks it questions over its own
 * automation protocol. There is no page-to-server channel: the page exposes `window.scenoco`,
 * and every tool is one `evaluate` against it.
 *
 * Headless by default. Chrome's headless mode renders through the same GPU stack as a window
 * (an M-series Mac reports "ANGLE Metal Renderer" from it), so nothing pops up on the person's
 * screen while an agent works; `headed: true` shows the window for whoever wants to watch.
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ObserverCommand, ObserverResult } from './protocol.js';

export interface BrowserOptions {
  /** Show the window. */
  headed?: boolean;
  /** A browser executable, when Chrome is not where the OS keeps it. */
  executable?: string;
}

export interface ScenePage {
  /** Run one command in the page and return its result; throws with the page's message on failure. */
  call(command: ObserverCommand): Promise<ObserverResult>;
  close(): Promise<void>;
}

/** Launch the browser, open `url`, and wait until the page is ready to answer. */
export async function openScenePage(url: string, options: BrowserOptions = {}): Promise<ScenePage> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      ...(options.executable ? { executablePath: options.executable } : { channel: 'chrome' }),
      headless: !options.headed,
      // Ask for the GPU explicitly. Without these, some Chrome builds fall back to a software
      // rasterizer in headless mode, and a software render is wrong often enough to mislead.
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    });
  } catch (error) {
    throw new Error(
      'could not launch Chrome. Install Google Chrome, or pass --browser <path to an executable>.\n' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // `commit`, not `networkidle`. Playwright's own guidance is to wait for the thing you actually
  // need rather than for the network to fall quiet, and here that thing is `window.scenoco` —
  // `ready()`, on the next line. `networkidle` waits for 500ms of silence on top of it, which on
  // a Vite dev server that keeps an HMR socket open proves nothing and cost ~500ms of every open.
  await page.goto(url, { waitUntil: 'commit' });
  const ready = (): Promise<unknown> =>
    page.waitForFunction(() => (window as unknown as { scenoco?: unknown }).scenoco !== undefined, undefined, { timeout: 20_000 });
  await ready();
  const evaluate = (command: ObserverCommand): Promise<unknown> =>
    page.evaluate(
      (c) => (window as unknown as { scenoco: { call(c: unknown): Promise<unknown> } }).scenoco.call(c),
      command,
    );
  return {
    async call(command) {
      let reply: unknown;
      try {
        reply = await evaluate(command);
      } catch (error) {
        // The page reloaded under the call — Vite does that once, the first time it optimizes a
        // dependency it had not seen. The page is the same page afterwards; ask again.
        if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
        await ready();
        reply = await evaluate(command);
      }
      const answer = reply as { ok: true; result: ObserverResult } | { ok: false; error: string };
      if (!answer.ok) throw new Error(answer.error);
      return answer.result;
    },
    close: () => browser.close(),
  };
}
