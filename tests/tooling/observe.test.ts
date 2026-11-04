import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';

// What a test harness does on its own: its Vite, its browser, its page — then the bridge, through page.evaluate.
const breakout = fileURLToPath(new URL('../../examples/breakout', import.meta.url));

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const pageErrors: string[] = [];
beforeAll(async () => {
  server = await createServer({ root: breakout, configFile: `${breakout}/vite.config.ts`, logLevel: 'silent', server: { port: 0, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('console', (message) => {
    if (message.type() === 'error' && /Shader|WebGL/.test(message.text())) pageErrors.push(message.text());
  });
  await page.goto(server.resolvedUrls!.local[0]!);
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;
declare const __scenoco: Bridge;

describe('the game from Playwright', () => {
  it('draws through its Volume from the first scene on: shaders compiled, and a picture', async () => {
    await page.waitForFunction(() => 'ready' in ((window as { __scenoco?: object }).__scenoco ?? {}));
    await page.evaluate(() => __scenoco.ready!());
    // Read in the frame it was drawn: the drawing buffer is cleared once the page has shown it.
    const brightest = await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() => {
            const gl = document.querySelector('canvas')!.getContext('webgl2')!;
            const pixels = new Uint8Array(gl.drawingBufferWidth * 4);
            gl.readPixels(0, gl.drawingBufferHeight >> 1, gl.drawingBufferWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            resolve(Math.max(...pixels.filter((_, i) => i % 4 !== 3)));
          }),
        ),
    );
    expect(pageErrors).toEqual([]);
    expect(brightest).toBeGreaterThan(40);
  }, 60_000);

  it('needs nothing but page.evaluate: exact frames, input, conditions and readings, from the bridge', async () => {
    // What an agent with only a browser tool does: evaluate in the page, with the bridge's own help to go on.
    await page.waitForFunction(() => 'ready' in (window as { __scenoco?: object }).__scenoco!);
    await page.evaluate(() => __scenoco.ready!());
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

  it('steps and reads without waiting for a paint, as a bot does', async () => {
    // Counted in the page's paints, not in seconds: a machine without a GPU draws each step slowly.
    const { steps, paints } = await page.evaluate(async () => {
      const steps = 30;
      let paints = 0;
      let counting = true;
      const count = () => {
        paints++;
        if (counting) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      for (let i = 0; i < steps; i++) {
        await __scenoco.eval!('return Time.frameCount');
        await __scenoco.step!(1);
      }
      counting = false;
      return { steps, paints };
    });
    expect(paints).toBeLessThan(steps * 4); // waiting for a paint in both calls takes at least 4 per step
  }, 60_000);

  it('a screenshot taken right after a step shows that step', async () => {
    // Without a wait for the paint in the bridge, what the tool captures has to be the frame just stepped.
    const red = (png: Buffer) =>
      page.evaluate(async (base64) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d')!;
        context.drawImage(image, -480, -600);
        return context.getImageData(0, 0, 1, 1).data[0]!;
      }, png.toString('base64'));
    // Red around the camera, on and off. The page dims it, so the two only have to tell apart.
    await page.evaluate(() =>
      __scenoco.eval!(`
        const cover = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial({ color: '#ff0000', side: THREE.BackSide, depthTest: false, toneMapped: false, fog: false }));
        cover.name = 'Cover';
        cover.renderOrder = 999;
        camera.add(cover);`),
    );
    // A new shader's first frames can reach the screen late, with or without a wait: past those.
    await page.waitForTimeout(500);
    for (let i = 0; i < 12; i++) {
      const on = i % 2 === 0;
      await page.evaluate(async (on) => {
        await __scenoco.eval!(`node('Cover').visible = ${on}`);
        await __scenoco.step!(1);
      }, on);
      const seen = await red(await page.screenshot());
      if (on) expect(seen).toBeGreaterThan(30);
      else expect(seen).toBeLessThan(20);
    }
  }, 60_000);

  it("answers a mistake with the game's own message", async () => {
    expect(await page.evaluate(() => __scenoco.eval!('return findAll(Brick).length'))).toBeGreaterThan(0);
    await expect(page.evaluate(() => __scenoco.eval!('return Game.state'))).rejects.toThrow(/Game is not defined\. This game's behaviour classes so far: .*GameState/);
    // The game's component lookups are here as in a behaviour; a helper that is not says what is.
    expect(await page.evaluate(() => __scenoco.eval!('return getComponent(find(GameState).node, GameState) === find(GameState)'))).toBe(true);
    await expect(page.evaluate(() => __scenoco.eval!('return getComponnet(scene, GameState)'))).rejects.toThrow(/getComponnet is not in this scope\. What is: .*getComponent/);
    // A swipe as adb and Appium write it, four numbers: refused with the same swipe as two points.
    await expect(page.evaluate(() => __scenoco.swipe!(500, 400, 300, 400))).rejects.toThrow('swipe takes two points, not four numbers: swipe([500, 400], [300, 400]).');
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
