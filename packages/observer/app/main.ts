/**
 * The observer's page: the real scene, and one object the observer asks.
 *
 * Nothing here talks to a server. The observer owns the browser this runs in and calls
 * `window.scenoco.call(command)` through the browser's automation protocol; the page's only
 * jobs are to load the generated module the server compiled, run it, and answer.
 */
import { ObserverSession } from './session.js';
import type { ObserverCommand, ObserverResult } from '../src/protocol.js';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const session = new ObserverSession(canvas);

async function open(path: string): Promise<void> {
  const response = await fetch(`/@scenoco/document?path=${encodeURIComponent(path)}`);
  const body = (await response.json()) as { path: string; module: string } | { error: string };
  if ('error' in body) throw new Error(`${path}: ${body.error}`);
  // Cache-busted: the module may have been rebuilt since it was last imported.
  await session.open(`${body.module}?v=${Date.now()}`);
  session.frameAll();
  status.textContent = `observer — ${path}`;
}

async function run(command: ObserverCommand): Promise<ObserverResult> {
  // `open` builds the scene and `stop` rebuilds it; everything else reads one, so it waits for a
  // load the game itself started rather than reporting the gap as an absence.
  if (command.type !== 'open' && command.type !== 'stop') await session.settled();
  switch (command.type) {
    case 'open':
      await open(command.path);
      return { kind: 'ok', info: command.path };
    case 'run':
      session.run();
      return { kind: 'ok' };
    case 'pause':
      session.pause();
      return { kind: 'ok' };
    case 'stop':
      await session.stop();
      return { kind: 'ok' };
    case 'preview':
      session.fit(command.frame);
      return { kind: 'image', dataUrl: session.preview(command.frame, command.cameraPos, command.lookAt, command.fov) };
    case 'telemetry':
      return { kind: 'json', data: session.telemetry(command.targetId) };
    case 'outline':
      return { kind: 'text', text: session.outline(command.targetId, command.depth) };
    case 'simulate':
      session.fit(command.frame);
      return {
        kind: 'multi',
        results: (await session.simulate(command.steps, command.frame)).map((r) =>
          r.kind === 'image'
            ? { kind: 'image' as const, dataUrl: r.value as string }
            : r.kind === 'text'
              ? { kind: 'text' as const, text: r.value as string }
              : { kind: 'json' as const, data: r.value },
        ),
      };
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  session.tick(dt);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => session.resize());
requestAnimationFrame(frame);

// What the observer calls. A reply rather than a throw, so a failure crosses the protocol as a
// message instead of an exception with the page's stack in it.
(window as unknown as { scenoco: unknown }).scenoco = {
  session,
  async call(command: ObserverCommand): Promise<{ ok: true; result: ObserverResult } | { ok: false; error: string }> {
    try {
      return { ok: true, result: await run(command) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
