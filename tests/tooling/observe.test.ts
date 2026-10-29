import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { observe } from '@scenoco-three/observer';

// What a test harness does on its own: its Vite, its browser, its page — then observe(page).
const breakout = fileURLToPath(new URL('../../examples/breakout', import.meta.url));

let server: ViteDevServer;
let browser: Browser;
let page: Page;
beforeAll(async () => {
  server = await createServer({ root: breakout, configFile: `${breakout}/vite.config.ts`, logLevel: 'silent', server: { port: 0, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.goto(server.resolvedUrls!.local[0]!);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;
declare const __scenoco: Bridge;

describe('the game from Playwright', () => {
  it('needs nothing but page.evaluate: exact frames, input, conditions and readings, from the bridge', async () => {
    // What an agent with only a browser tool does: evaluate in the page, with the bridge's own help to go on.
    await observe(page); // only waits for the game to be up
    expect(await page.evaluate(() => __scenoco.help!())).toMatch(/until\(code, maxFrames = 600\)/);
    const started = await page.evaluate(async () => {
      await __scenoco.pause!();
      const rows = (await __scenoco.watch!(['GameState.phase'], 20, 10)) as { frame: number }[];
      await __scenoco.press!('Space'); // past the splash
      await __scenoco.press!('Space'); // the launch
      const until = await __scenoco.until!("GameState.phase === 'playing'", 60);
      return { frames: rows.map((r) => r.frame - rows[0]!.frame), until };
    });
    expect(started.frames).toEqual([0, 10, 20]);
    expect(started.until).toMatchObject({ met: true, held: true });
    // A name the live object lacks is the class's: a static reads the same way a field does.
    expect(await page.evaluate(() => __scenoco.eval!('return GameState.prototype === find(GameState).constructor.prototype'))).toBe(true);

    const before = await page.evaluate(() => __scenoco.clock!());
    await new Promise((done) => setTimeout(done, 300));
    expect(await page.evaluate(() => __scenoco.clock!())).toEqual(before); // held: real time does not move it
  }, 60_000);

  it('is the same calls through observe(page), with the game\'s own message on a mistake', async () => {
    const game = await observe(page);
    expect(await game.eval('return findAll(Brick).length')).toBeGreaterThan(0);
    await expect(game.eval('return Game.state')).rejects.toThrow(/^Game is not defined\. This game's behaviour classes so far: .*GameState/);
  }, 60_000);

  it("drives the game from ?drive= with data only, one console line per call; the editor's endpoints answer only this page", async () => {
    const lines: string[] = [];
    page.on('console', (m) => void (m.text().startsWith('[scenoco]') && lines.push(m.text())));
    const url = server.resolvedUrls!.local[0]!;
    const go = async (drive: string) => {
      lines.length = 0;
      await page.goto(`${url}?drive=${encodeURIComponent(drive)}`);
      await expect.poll(() => lines.at(-1), { timeout: 15_000 }).toMatch(/done, held at frame|did not run|could not be read/);
      return lines.slice();
    };
    const played = await go(`press('Space');press('Space');until(GameState.phase == 'playing');read(count(Brick) > 0)`);
    expect(played).toEqual([
      '[scenoco] press("Space") → done',
      '[scenoco] press("Space") → done',
      expect.stringMatching(/^\[scenoco\] until\(GameState\.phase == "playing"\) → \{"met":true/),
      '[scenoco] read(count(Brick) > 0) → true',
      expect.stringMatching(/^\[scenoco\] done, held at frame \d+/),
    ]);

    // Data, never code: no way from a field to Function, and no calls but the lookups.
    expect((await go(`read(GameState.constructor)`))[0]).toMatch(/does not read constructor/);
    expect((await go(`read(fetch('/'))`))[0]).toMatch(/fetch\(\) is not something drive calls/);

    // What a page on another site would send: the editor's endpoints say no.
    const from = { 'sec-fetch-site': 'cross-site' };
    expect((await fetch(`${url}__scenoco/set`, { method: 'POST', headers: from, body: '{}' })).status).toBe(403);
  }, 60_000);
});
