/**
 * The observer's MCP surface: **eyes, not hands.**
 *
 * See the game, drive it with the player's own input, read its state, and step its clock. No tool
 * writes to the project — an agent has file tools for that, and the observer reloads whatever
 * they write. The one pair of hands is `eval`, and it reaches the running page only: `reload`
 * discards everything it did.
 *
 * `simulate` is the tool that matters. A screenshot of frame zero says almost nothing about whether
 * a game works; drive it to the moment that matters, then look — in one call, on the frame named.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FRAME, type Game } from './game.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };

/** A step refuses a key it does not know, instead of dropping it silently. */
const step = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const DT = 'Seconds per frame (default 1/60)';
const KEY = 'A key as Playwright names it: "ArrowLeft", "Space", "Enter", "Escape", "a", "Shift"';
const XY = 'Pixels from the top-left of the window';

const viewpoint = {
  cameraPos: z
    .array(z.number())
    .length(3)
    .optional()
    .describe('Look from here, [x, y, z], instead of the game camera. Leave out for exactly what the player sees, HUD included'),
  lookAt: z
    .union([z.array(z.number()).length(3), z.string()])
    .optional()
    .describe('With cameraPos: a point [x, y, z], or a node by the name you gave it in JSX, "#<name>". Default the origin'),
  fov: z.number().positive().optional().describe('With cameraPos: vertical field of view in degrees'),
};

const frame = {
  width: z.number().int().positive().default(FRAME.width).describe('Window width in pixels — 390×844 is a phone'),
  height: z.number().int().positive().default(FRAME.height).describe('Window height in pixels'),
};

/** The lowest log level to show — the same on the `console` tool and the `console` step. */
const LEVEL = z.enum(['error', 'warning', 'info', 'log', 'debug']).default('log').describe('Lowest level to include');
const RANK = { error: 0, warning: 1, info: 2, log: 3, debug: 4 } as const;

/** On a screenshot step, the window for that one shot — where a model writes it anyway. */
const shotSize = {
  width: z.number().int().positive().optional().describe('Window width for this shot; the call’s otherwise'),
  height: z.number().int().positive().optional().describe('Window height for this shot; the call’s otherwise'),
};

const ALL_STEPS = [
  step({ do: z.literal('play') }).describe('Run the game in real time'),
  step({ do: z.literal('pause') }).describe('Hold the game clock where it is'),
  step({ do: z.literal('reload') }).describe('Start the game over from a fresh page'),
  step({
    do: z.literal('step'),
    frames: z.number().int().positive().default(1).describe('Frames to advance'),
    dt: z.number().positive().optional().describe(DT),
  }).describe('Hold the clock and advance exactly this many frames — deterministic'),
  step({ do: z.literal('wait'), seconds: z.number().positive().describe('Real seconds') }).describe(
    'Let real time pass — the game moves only while playing',
  ),
  step({
    do: z.literal('press'),
    key: z.string().describe(KEY),
    frames: z.number().int().positive().default(6).describe('Frames to hold it (default 6, a tap)'),
  }).describe('Press and release a key'),
  step({ do: z.literal('keyDown'), key: z.string().describe(KEY) }).describe('Hold a key down'),
  step({ do: z.literal('keyUp'), key: z.string().describe(KEY) }).describe('Release a held key'),
  step({ do: z.literal('click'), x: z.number().describe(XY), y: z.number().describe(XY) }).describe('Click or tap'),
  step({ do: z.literal('pointerDown'), x: z.number().optional().describe(XY), y: z.number().optional().describe(XY) }).describe(
    'Press the pointer and keep it down',
  ),
  step({ do: z.literal('pointerUp') }).describe('Lift the pointer'),
  step({ do: z.literal('move'), x: z.number().describe(XY), y: z.number().describe(XY) }).describe('Move the pointer'),
  step({
    do: z.literal('swipe'),
    from: z.array(z.number()).length(2).describe('[x, y] in pixels'),
    to: z.array(z.number()).length(2).describe('[x, y] in pixels'),
    frames: z.number().int().positive().default(8).describe('Frames the swipe takes'),
  }).describe('Press, drag and lift — a touch swipe'),
  step({
    do: z.literal('until'),
    code: z
      .string()
      .describe(
        'A JavaScript condition. `Game.state` reads the first live Game behaviour, `#<name>.position` a node by ' +
          'the name you gave it in JSX; `findAll("Coin").length`, `Time.time` work too. e.g. "Game.state === \'over\'"',
      ),
    maxFrames: z.number().int().positive().default(600).describe('Give up after this many frames (default 600, 10 s)'),
    dt: z.number().positive().optional().describe(DT),
  }).describe('Hold the clock and step until the condition is true — for "when the train arrives", not "after 3 s"'),
  step({
    do: z.literal('watch'),
    fields: z.array(z.string()).min(1).describe('Expressions to read, as in `until`: ["Player.lane", "Game.score"]'),
    frames: z.number().int().positive().default(60).describe('Frames to run'),
    every: z.number().int().positive().default(10).describe('Read every this many frames'),
    dt: z.number().positive().optional().describe(DT),
  }).describe('Hold the clock, step, and return a table of the values over time — telemetry'),
  step({ do: z.literal('screenshot'), ...viewpoint, ...shotSize }).describe('A PNG of this moment'),
  step({ do: z.literal('telemetry'), target: z.string().describe('"Player", "Player.lane" or "#<node name>"') }).describe(
    'Read state as JSON — see the telemetry tool',
  ),
  step({ do: z.literal('outline'), depth: z.number().int().positive().default(4) }).describe('The scene as text'),
  step({ do: z.literal('console'), level: LEVEL }).describe("What the page logged since the call began — warnings and errors come at the end of every reply anyway"),
  step({
    do: z.literal('eval'),
    code: z.string().describe('The body of an async function; `return` a value to see it'),
  }).describe(
    'Set up or read a situation in JavaScript against the running game. In scope: every live behaviour class by ' +
      'name, find(Type | "Type"), findAll(…), node("name"), destroy(), scene, camera, Time, Input, SceneManager, THREE. ' +
      'e.g. `find(Player).invincible = true` — `Time.timeScale = 0.25` — `return findAll(Coin).length`. ' +
      'It never touches a file; `reload` discards it.',
  ),
] as const;

/** Every step, for a game on SceNoCo. */
const STEPS = z.discriminatedUnion('do', ALL_STEPS);
type Step = z.infer<typeof STEPS>;

/** Steps that read the game through the bridge `play()` installs. */
const LAYER_ONLY = new Set(['play', 'pause', 'step', 'until', 'watch', 'telemetry', 'outline', 'screenshot', 'eval']);

/**
 * What a page without the layer can do: input, real time, plain pictures, plain JavaScript. Offering
 * the rest only to refuse it cost a model a turn per refusal, every session.
 */
const PAGE_STEPS = z.discriminatedUnion('do', [
  ...ALL_STEPS.filter((s) => !LAYER_ONLY.has(s.shape.do.value)),
  step({ do: z.literal('screenshot'), ...shotSize }).describe('A PNG of what the player sees, HUD included'),
  step({
    do: z.literal('eval'),
    code: z.string().describe('The body of an async function run in the page; `return` a value to see it'),
  }).describe('Read or set up a situation in JavaScript in the page — window, document, whatever the game exposes'),
] as unknown as typeof ALL_STEPS);

export interface ObserverOptions {
  /** The project runs on SceNoCo: the clock, outline and telemetry tools are offered. */
  layer: boolean;
}

export function createObserver(game: () => Promise<Game>, { layer }: ObserverOptions): McpServer {
  const mcp = new McpServer({ name: 'scenoco-observer', version: '0.7.0' });
  let reported = 0;
  /** Where the page's log stood when the current `simulate` began. */
  let callStart = 0;

  /** Every reply ends with what the page said since the last one, and with a reload if there was one. */
  const reply = async (content: Content[], note?: string | null): Promise<{ content: Content[] }> => {
    const g = await game();
    const fresh = g.consoleSince(reported).filter((e) => e.level === 'error' || e.level === 'warning');
    reported = g.consoleSeq;
    if (note) content.unshift({ type: 'text', text: note });
    if (fresh.length) {
      const lines = fresh.map((e) => `  ${e.level === 'error' ? '✗' : '⚠'} ${e.text}`);
      content.push({ type: 'text', text: `${fresh.length} new console message(s) from the page:\n${lines.join('\n')}` });
    }
    return { content };
  };

  /** The game, reloaded first if its source changed. */
  const ready = async () => {
    const g = await game();
    return { g, note: await g.freshen() };
  };

  const picture = async (g: Game, view: { cameraPos?: number[]; lookAt?: number[] | string; fov?: number }): Promise<Content> => {
    if (view.cameraPos) {
      const url = await g.bridge<string>('view', view);
      return { type: 'image', data: url.split(',')[1] ?? '', mimeType: 'image/png' };
    }
    const png = await g.page.screenshot({ type: 'png' });
    return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' };
  };

  const json = (value: unknown): Content => ({ type: 'text', text: JSON.stringify(value, null, 2) });

  mcp.registerTool(
    'screenshot',
    {
      description:
        layer
          ? 'A PNG of the game now. With no viewpoint it is exactly what the player sees, HUD included; with cameraPos it ' +
            'is the 3D scene from there. To capture a particular moment, use `simulate` and drive the game to it.'
          : 'A PNG of the game now, exactly as the player sees it. To capture a particular moment, use `simulate`.',
      inputSchema: layer ? { ...viewpoint, ...frame } : frame,
    },
    async ({ width, height, ...view }) => {
      const { g, note } = await ready();
      await g.resize(width, height);
      return reply([await picture(g, view)], note);
    },
  );

  if (layer) registerLayerTools();

  function registerLayerTools() {
  mcp.registerTool(
    'outline',
    {
      description:
        'The scene as text: named nodes and nodes with behaviours, their world positions, and each behaviour with ' +
          'its fields — plus the clock. The cheapest and most exact view; read it before a screenshot.',
      inputSchema: { depth: z.number().int().positive().default(4).describe('Levels to show') },
    },
    async ({ depth }) => {
      const { g, note } = await ready();
      return reply([{ type: 'text', text: await g.bridge<string>('outline', depth) }], note);
    },
  );

  mcp.registerTool(
    'telemetry',
    {
      description:
        'Live state as JSON. "Player" — every live Player behaviour with its fields and getters; "Player.lane" — ' +
          'that value from each; "#<name>" — a node by its JSX name: transform, visibility, behaviours.',
      inputSchema: { target: z.string().describe('"Player", "Player.lane" or "#<node name>"') },
    },
    async ({ target }) => {
      const { g, note } = await ready();
      return reply([json(await g.bridge('telemetry', target))], note);
    },
  );

  for (const [name, what] of [
    ['play', 'Run the game in real time.'],
    ['pause', 'Hold the game clock where it is. `simulate` steps it frame by frame.'],
  ] as const) {
    mcp.registerTool(name, { description: what, inputSchema: {} }, async () => {
      const { g, note } = await ready();
      const text = await control(g, name);
      return reply([{ type: 'text', text }], note);
    });
  }
  }

  mcp.registerTool('reload', { description: 'Start the game over from a fresh page — everything `eval` did is gone.', inputSchema: {} }, async () => {
    const { g, note } = await ready();
    return reply([{ type: 'text', text: await control(g, 'reload') }], note);
  });

  mcp.registerTool(
    'simulate',
    {
      description: layer
        ? 'Drive the game and look, in one call: input, frame stepping, waiting for a condition, telemetry over time, ' +
          'screenshots. Steps run in order. `step`, `until` and `watch` hold the clock, so what they return is the exact ' +
          'frame — deterministic; `play` lets it run in real time again. Prefer `until` to guessing seconds.'
        : 'Drive the game and look, in one call: keys, clicks, swipes, real-time waits, screenshots and JavaScript. ' +
          'Steps run in order, in real time.',
      inputSchema: {
        steps: z
          .array(layer ? STEPS : PAGE_STEPS)
          .min(1)
          .describe(layer ? 'Ordered steps; screenshot, telemetry, outline, watch, until and eval produce output' : 'Ordered steps; screenshot and eval produce output'),
        ...frame,
      },
    },
    async ({ steps, width, height }) => {
      const { g, note } = await ready();
      await g.resize(width, height);
      callStart = g.consoleSeq;
      const out: Content[] = [];
      for (const [index, s] of steps.entries()) {
        const label = `[${index + 1}] ${s.do}`;
        try {
          const produced = await run(g, s);
          for (const item of produced) out.push(item.type === 'text' ? { type: 'text', text: `${label}: ${item.text}` } : item);
        } catch (error) {
          out.push({ type: 'text', text: `${label} failed: ${error instanceof Error ? error.message : String(error)}\nThe remaining steps did not run.` });
          break;
        }
      }
      if (out.length === 0) out.push({ type: 'text', text: 'done — no step produced output' });
      return reply(out, note);
    },
  );

  mcp.registerTool(
    'console',
    {
      description: "The page's log. New warnings and errors already come with every reply; this shows all of it.",
      inputSchema: {
        level: LEVEL,
        limit: z.number().int().positive().default(50),
      },
    },
    async ({ level, limit }) => {
      const g = await game();
      const entries = g.consoleSince(0).filter((e) => RANK[e.level] <= RANK[level]).slice(-limit);
      reported = g.consoleSeq;
      return { content: [{ type: 'text' as const, text: entries.map((e) => `${e.level}: ${e.text}`).join('\n') || 'nothing logged at this level' }] };
    },
  );

  async function control(g: Game, what: 'play' | 'pause' | 'reload'): Promise<string> {
    if (what === 'reload') {
      await g.reload();
      return 'reloaded — the game runs in real time from the start';
    }
    const c = await g.bridge<{ time: number; frame: number }>('hold', what === 'pause').then(() => g.bridge<{ time: number; frame: number }>('clock'));
    return `${what === 'pause' ? 'held' : 'playing'} at ${c.time}s, frame ${c.frame}`;
  }

  /** One step; returns what it produced. */
  async function run(g: Game, s: Step): Promise<Content[]> {
    const dt = 'dt' in s && s.dt ? s.dt : 1 / 60;
    const held = async () => (g.hasBridge ? (await g.bridge<{ held: boolean }>('clock')).held : false);
    /** Let n frames pass: stepped when the clock is held, in real time otherwise. */
    const frames = async (n: number) => {
      if (await held()) await g.bridge('step', n, dt);
      else await g.page.waitForTimeout((n * 1000) / 60);
    };
    const hold = async () => {
      if (!(await held())) await g.bridge('hold', true);
    };
    switch (s.do) {
      case 'play':
      case 'pause':
      case 'reload':
        await control(g, s.do);
        return [];
      case 'step': {
        await hold();
        const c = await g.bridge<{ time: number; frame: number }>('step', s.frames, dt);
        void c;
        return [];
      }
      case 'wait':
        await g.page.waitForTimeout(s.seconds * 1000);
        return (await held())
          ? [{ type: 'text', text: 'the clock is held, so the game did not move — `play` first, or `step`' }]
          : [];
      case 'press':
        await g.page.keyboard.down(s.key);
        await frames(s.frames);
        await g.page.keyboard.up(s.key);
        return [];
      case 'keyDown':
        await g.page.keyboard.down(s.key);
        return [];
      case 'keyUp':
        await g.page.keyboard.up(s.key);
        return [];
      case 'click':
        await g.page.mouse.click(s.x, s.y);
        await frames(1);
        return [];
      case 'pointerDown':
        if (s.x !== undefined && s.y !== undefined) await g.page.mouse.move(s.x, s.y);
        await g.page.mouse.down();
        return [];
      case 'pointerUp':
        await g.page.mouse.up();
        return [];
      case 'move':
        await g.page.mouse.move(s.x, s.y);
        return [];
      case 'swipe': {
        const [x0, y0] = s.from as [number, number];
        const [x1, y1] = s.to as [number, number];
        await g.page.mouse.move(x0, y0);
        await g.page.mouse.down();
        for (let i = 1; i <= s.frames; i++) {
          await g.page.mouse.move(x0 + ((x1 - x0) * i) / s.frames, y0 + ((y1 - y0) * i) / s.frames);
          await frames(1);
        }
        await g.page.mouse.up();
        return [];
      }
      case 'until': {
        await hold();
        const r = await g.bridge<{ met: boolean; frames: number; time: number; frame: number }>('until', s.code, s.maxFrames, dt);
        return [
          {
            type: 'text',
            text: r.met
              ? `true after ${r.frames} frames — now ${r.time}s, frame ${r.frame}`
              : `still false after ${r.frames} frames (now ${r.time}s, frame ${r.frame}). The remaining steps ran anyway.`,
          },
        ];
      }
      case 'watch': {
        await hold();
        return [{ type: 'text', text: `\n${await g.bridge<string>('watch', s.fields, s.frames, s.every, dt)}` }];
      }
      case 'screenshot': {
        const size = g.page.viewportSize()!;
        if (s.width || s.height) await g.resize(s.width ?? size.width, s.height ?? size.height);
        const shot = await picture(g, s);
        if (s.width || s.height) await g.resize(size.width, size.height);
        return [shot];
      }
      case 'telemetry':
        return [json(await g.bridge('telemetry', s.target))];
      case 'outline':
        return [{ type: 'text', text: `\n${await g.bridge<string>('outline', s.depth)}` }];
      case 'console': {
        const lines = g.consoleSince(callStart).filter((e) => RANK[e.level] <= RANK[s.level]).map((e) => `${e.level}: ${e.text}`);
        return [{ type: 'text', text: lines.length ? `\n${lines.join('\n')}` : 'nothing logged during this call so far' }];
      }
      case 'eval': {
        const value = g.hasBridge
          ? await g.bridge('evaluate', s.code)
          : await g.page.evaluate((code) => new Function(`return (async () => {\n${code}\n})();`)(), s.code);
        return [json(value ?? null)];
      }
    }
  }

  return mcp;
}

/** Serve over stdio — what an MCP client spawns. Nothing else may print to stdout. */
export async function serveStdio(mcp: McpServer, onClose: () => void): Promise<void> {
  const transport = new StdioServerTransport();
  transport.onclose = onClose;
  await mcp.connect(transport);
}
