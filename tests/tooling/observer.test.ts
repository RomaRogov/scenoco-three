import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The real thing: the built stdio server, breakout's own Vite and a headless Chrome. Build first.
const cli = fileURLToPath(new URL('../../packages/observer/dist/cli.js', import.meta.url));
const breakout = fileURLToPath(new URL('../../examples/breakout', import.meta.url));

let client: Client;
beforeAll(async () => {
  client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [cli, '--root', breakout], stderr: 'ignore' }));
}, 60_000);
afterAll(() => client?.close());

type Item = { type: string; text?: string; data?: string };
const call = async (name: string, args: object) =>
  (await client.callTool({ name, arguments: args as Record<string, unknown> })).content as Item[];
const texts = (items: Item[]) => items.filter((i) => i.type === 'text').map((i) => i.text!).join('\n');

describe('observer', () => {
  it('holds the clock, plays to a condition on an exact frame, and reads state and pixels there', async () => {
    const out = await call('simulate', {
      steps: [
        { do: 'pause' },
        { do: 'watch', fields: ['GameState.phase', 'Time.frameCount'], frames: 20, every: 10 },
        { do: 'press', key: 'Space' },
        { do: 'until', code: "GameState.phase === 'playing'", maxFrames: 60 },
        { do: 'until', code: 'GameState.bricksLeft < 19', maxFrames: 1200 },
        { do: 'telemetry', target: 'Progress' },
        { do: 'screenshot' },
        { do: 'eval', code: 'return findAll(Brick).length' },
        // The game's own destroy, deferred to the end of the frame as in a behaviour.
        { do: 'eval', code: 'destroy(findAll(Brick)[0].node)' },
        { do: 'step', frames: 1 },
        { do: 'eval', code: 'return findAll(Brick).length' },
        { do: 'eval', code: 'return SceneManager.activeScene !== null' },
      ],
    });
    const text = texts(out);
    // Twenty held frames are exactly twenty frames.
    const frames = [...text.matchAll(/^[\d.]+\t(\d+)\t/gm)].map((m) => Number(m[1]));
    expect(frames[2]! - frames[0]!).toBe(20);
    expect(text).toMatch(/\[5\] until: true after \d+ frames/);
    expect(text).toMatch(/"score": [1-9]\d*/);
    expect(text).toMatch(/\[8\] eval: 18/);
    expect(text).toMatch(/\[11\] eval: 17/);
    expect(text).toMatch(/\[12\] eval: true/);
    expect(out.some((i) => i.type === 'image' && i.data!.length > 1000)).toBe(true);

    const outline = texts(await call('outline', { depth: 3 }));
    expect(outline).toMatch(/held by the observer/);
    expect(outline).toMatch(/Progress \{/);
  }, 90_000);

  it('answers a wrong name with the classes there are', async () => {
    const text = texts(await call('simulate', { steps: [{ do: 'eval', code: 'return Game.state' }] }));
    expect(text).toMatch(/eval failed: Game is not defined\. This game's behaviour classes so far: .*GameState/);
  }, 60_000);
});
