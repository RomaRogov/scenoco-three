import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { anchoredPoint, boxOfAuthored, pointOf } from '../../packages/observer/app/session.js';
import { createMcpServer, startMcpHttp } from '../../packages/observer/src/mcp.js';
import { depCacheDir, startProjectServer } from '../../packages/observer/src/server.js';
import { STALE_MODULE } from '../../packages/observer/src/browser.js';
import { indexDocument } from '../../packages/compiler/src/index.js';
import { makeFixture } from '../compiler/fixture.js';


/**
 * What the editor draws, as opposed to what the game draws.
 *
 * Every frame the editor showed — the viewport and every `screenshot`/`simulate` an agent took —
 * went through `renderer.render` directly, which skips `Engine`'s render pipeline: tone mapping,
 * fog, and the whole post chain. A scene with `<Bloom>` in its render document looked flat, and
 * an agent asked to add a `<Vignette>` had no way to see whether it had worked.
 *
 * There is no unit test for the fix itself — a `WebGLRenderer` needs a GL context and these run
 * in Node — so this pins the invariant at the source instead. It is a weak test of a real
 * property, which beats no test of it.
 */
describe('the observer draws through the engine', () => {
  const session = readFileSync(
    fileURLToPath(new URL('../../packages/observer/app/session.ts', import.meta.url)),
    'utf8',
  );

  it('never renders the scene straight to the renderer', () => {
    // The UI overlay is exempt: it is a second pass over a finished frame, deliberately drawn
    // without clearing and without the post chain.
    const direct = [...session.matchAll(/this\.renderer\.render\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(direct.filter((args) => args.includes('this.scene'))).toEqual([]);
  });

  it('advances a batch without waiting for an animation frame', () => {
    // A hidden tab gets no animation frames at all, and the editor's tab is usually hidden
    // behind whatever the agent works in. A `step` that awaited one hung until someone clicked.
    const step = session.slice(session.indexOf('private async stepVisibly('));
    expect(step.slice(0, step.indexOf('\n  }'))).not.toContain('requestAnimationFrame(');
  });

  it('takes ui on a preview step, and refuses a step key it does not know rather than dropping it', () => {
    // A model wrote `ui: true` on the step; it was stripped in silence, a dozen shots came back with
    // no HUD, and the model reported that text does not render.
    const mcp = readFileSync(fileURLToPath(new URL('../../packages/observer/src/mcp.ts', import.meta.url)), 'utf8');
    expect(mcp).toContain('const strictStep = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();');
    expect(mcp).not.toMatch(/discriminatedUnion\('do', \[[^]*?z\s*\.object\(/);
    expect(session).toContain('step.ui === undefined ? frame : { ...frame, ui: step.ui }');
  });

  it('shows exactly what the player sees when a shot names no viewpoint', () => {
    // Every shot used to be aimed by the caller, so a game camera pointed at the horizon went
    // unseen through three builds that shipped a black screen.
    expect(session).toContain('const asPlayer = at === undefined;');
    // An empty one is refused with that answer, not taken to mean it.
    expect(session).toContain('cameraPos is empty — leave it out for exactly what the player sees');
    expect(session).toContain('const usingScene = (frame.ui || asPlayer) && this.scene.mainCamera;');
  });

  it('runs the game in the frame a call asks for, so a shot and a click share its pixels', () => {
    // 800×600 shots scaled off an 800×500 canvas sent every click 20% low, and runs reported dead
    // buttons. The frame is now the page's own size: the game resizes to it — camera, UI, input.
    const browser = readFileSync(fileURLToPath(new URL('../../packages/observer/src/browser.ts', import.meta.url)), 'utf8');
    expect(browser).toContain('await page.setViewportSize(viewport);');
    expect(session).toContain('fit(frame: PreviewFrame): void {');
    expect(session).not.toContain('setFrameSize');
    // Unscaled: a click lands at the pixels of the shot it was read from.
    expect(session).toContain('clientX: rect.left + point.x,');
  });

  it('forgets a scene whose load threw, rather than waiting on it as still loading', () => {
    expect(session).toContain('the scene failed to load: ${reason} — nothing is open');
    expect(session).toContain('this.sceneClass = null;');
  });

  it('puts the scene’s own classes in scope for eval, so a snippet reads as game code', () => {
    // With no class in scope, `getComponent(Button)` was a ReferenceError and `getComponent('Button')`
    // core's refusal: four tries in a row went nowhere.
    expect(session).toContain('const classes = { ...classesIn(scene) };');
    expect(session).not.toContain('looked up by its class');
  });

  it('relenses a capture that includes the UI by laying the UI out again, and back after', () => {
    // A <Canvas> is a plane parented to the game camera, sized to its frustum at *its* fov. It was
    // refused once, because the plane stayed put and the HUD came back cropped; uikit re-reads the
    // fov when it lays out, so a layout after the relens fits it — seen whole at fov 30 and 90.
    expect(session).not.toContain('Drop fov to keep the UI');
    const relens = session.indexOf('if (fov !== undefined) camera.fov = fov;');
    const layout = session.indexOf('for (const system of scene.systems) system.layout?.(0);', relens);
    expect(relens).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(relens);
    expect(session).toContain('if (usingScene && fov !== undefined) for (const system of scene.systems) system.layout?.(0);');
  });

  it('does not call a drawing UI element hidden', () => {
    // A uikit element draws through one shared instanced mesh and leaves its own `visible` false
    // for ever, so `outline` marked every <Panel> and <Text> of a working HUD `hidden` — the
    // first thing someone debugging an invisible HUD would chase. `displayed`/`isVisible` are
    // what govern drawing, and they follow `setActive`, so a genuinely hidden one still says so.
    expect(session).toContain('const drawn = (node: Object3D): boolean =>');
    // …and before uikit's first layout every one of those signals reads false, with `size` still
    // null — the state a freshly opened document is in, when the first `outline` is taken.
    expect(session).toContain('if (uikit.size?.value == null) return node.activeInHierarchy;');
    expect(session).toContain("`${drawn(node) ? '' : ' hidden'}`".slice(1, -1));
    // Duck-typed: @scenoco-three/ui is optional and the observer opens projects without it.
    expect(session).not.toContain("from '@pmndrs/uikit'");
  });

  it('waits out a load the game started, on every step but the one that escapes it', () => {
    // `SceneManager.load` is how a game restarts a round, and it is asynchronous: for as long as
    // it runs there is no active scene. Reporting that as "no scene is open" sent an agent
    // hunting for a bug it did not have, and stepping is no escape — `step` advances a synthetic
    // clock, so a load resolving on real timers never completes however many frames are asked
    // for. `stop` is exempt because it is the way out of a bad state.
    const loop = session.slice(session.indexOf('async simulate('));
    expect(loop).toContain("if (step.do !== 'stop') await this.settled();");
    expect(session).toContain('async settled()');
  });

  it('lays the UI out before a capture, so a shot shows the state and not the frame before it', () => {
    // A UI lays out once per tick. An `eval` that ended the round and a `preview` in the same
    // batch captured the HUD as it was before the eval: `panelActive: true`, and no panel.
    const capture = session.slice(session.indexOf('  preview(frame: PreviewFrame'));
    const body = capture.slice(0, capture.indexOf('\n  }\n'));
    expect(body.indexOf('system.layout?.(0)')).toBeGreaterThan(-1);
    expect(body.indexOf('system.layout?.(0)')).toBeLessThan(body.indexOf('this.engine.renderScene('));
  });

  it('waits for the post chain before a scene is considered open', () => {
    // Without this the *first* screenshot after opening shows no post passes, because the
    // composer is a dynamic import — and "no bloom" reads as "my <Bloom> is broken".
    expect(session).toContain('await this.engine.effectsReady()');
  });
});

/**
 * The MCP server outliving — and being outlived by — its client.
 *
 * The editor self-halts as soon as its last tab closes, so the ordinary lifecycle is: a client
 * initializes, the editor goes away, a new editor comes up on the same fixed port, and the client
 * is still holding a session id nobody has heard of. The protocol's answer to that id is 404, and
 * a client that gets one opens a fresh session. Anything else leaves the tools dead until the
 * client itself is restarted, which for an agent means the whole session.
 */
describe('the MCP transport across an observer restart', () => {
  // No browser in a transport test: the tools are never called, only listed.
  const serve = (port: number) =>
    startMcpHttp(() => createMcpServer(() => Promise.reject(new Error('no page in this test'))), port);

  const post = async (port: number, payload: unknown, session?: string) =>
    fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify(payload),
    });

  const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    },
  };

  it('answers a session id it has never heard of with 404, so the client opens a new one', async () => {
    const port = 55971;

    const first = await serve(port);
    const opened = await post(port, INITIALIZE);
    const session = opened.headers.get('mcp-session-id');
    expect(session).toBeTruthy();
    await first.close();

    // The editor restarts: same port, none of the old sessions.
    const second = await serve(port);
    try {
      const stale = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session!);
      expect(stale.status).toBe(404);

      // And the client can recover on the spot, without being restarted itself.
      const again = await post(port, INITIALIZE);
      expect(again.status).toBe(200);
      expect(again.headers.get('mcp-session-id')).toBeTruthy();
      expect(again.headers.get('mcp-session-id')).not.toBe(session);
    } finally {
      await second.close();
    }
  });

  it('needs nothing at all for a capture — no viewpoint is the player’s own', async () => {
    // `ui`, `width` and `height` were required once, and the first call every agent made
    // failed on "expected boolean, received undefined at ui". A default each is the whole fix.
    // `cameraPos` too, since a shot with none is the game camera as it stands.
    const port = 55973;
    const server = await serve(port);
    try {
      const opened = await post(port, INITIALIZE);
      const session = opened.headers.get('mcp-session-id')!;
      await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
      const listed = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
      const raw = await listed.text();
      const body = JSON.parse(raw.includes('data: ') ? raw.split('data: ').pop()!.trim() : raw);
      const tools = body.result.tools as { name: string; inputSchema: { required?: string[] } }[];
      expect(tools.find((t) => t.name === 'screenshot')!.inputSchema.required ?? []).toEqual([]);
      expect(tools.find((t) => t.name === 'simulate')!.inputSchema.required).toEqual(['steps']);
      // The verbs, as the client will see them. `eval` is the one with hands; it has to be there.
      const steps = tools.find((t) => t.name === 'simulate')!.inputSchema as unknown as {
        properties: { steps: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } };
      };
      const verbs = JSON.stringify(steps.properties.steps.items.oneOf ?? steps.properties.steps.items.anyOf);
      for (const verb of ['"eval"', '"telemetry"', '"preview"', '"step"']) expect(verbs).toContain(verb);
      // A drag is a held pointer that moves. Without a way to hold one, a game steered by
      // dragging could only be checked by reaching around it through `eval`.
      for (const verb of ['"click"', '"pointerDown"', '"pointerUp"', '"move"']) expect(verbs).toContain(verb);
    } finally {
      await server.close();
    }
  });

  it('still rejects a client that never initialized at all', async () => {
    const port = 55972;
    const server = await serve(port);
    try {
      const response = await post(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});

/**
 * What "frame the whole scene" is allowed to see.
 *
 * The editor draws into the same scene the game runs in, and the transform gizmo it adds carries
 * a picker plane 100000 units across. Any framing that measures the scene as a whole measures
 * that plane instead, and puts the camera so far out that everything real is behind the far
 * plane — a capture of the background and nothing else. The interactive path learned this; the
 * MCP's `camera="fit"` had the identical bug for as long as it shipped — that sentinel is
 * gone now, but `frameAll` still measures, so the filter still has to hold.
 */
describe('framing what the document authored', () => {
  const sceneWithGizmo = () => {
    const scene = new Scene();
    const cube = new Mesh(new BoxGeometry(1, 1, 1));
    cube.position.set(0, 0.5, 0);
    scene.add(cube);

    const gizmoHelper = new Mesh(new PlaneGeometry(100000, 100000));
    gizmoHelper.userData.scenocoToolOnly = true;
    scene.add(gizmoHelper);
    return scene;
  };

  it('ignores the gizmo, however much of the world it covers', () => {
    const box = boxOfAuthored(sceneWithGizmo());
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(1);
    expect(size.y).toBeCloseTo(1);
    expect(box.getCenter(new Vector3()).y).toBeCloseTo(0.5);
  });

  it('is empty when the document authored nothing, rather than the gizmo’s size', () => {
    const scene = new Scene();
    const helper = new Mesh(new PlaneGeometry(100000, 100000));
    helper.userData.scenocoToolOnly = true;
    scene.add(helper);
    expect(boxOfAuthored(scene).isEmpty()).toBe(true);
  });
});

/**
 * Where a capture points.
 *
 * `cameraPos`, `lookAt` and `fov` are three numbers the caller states, and the same three give
 * the same picture. Nothing about a capture is derived from the scene any more: `camera="fit"`
 * derived a viewpoint, measured the editor's own gizmo while doing it, and returned a valid PNG
 * of an empty frame — a failure indistinguishable from an empty scene.
 */
describe('anchoring a capture on a thing', () => {
  it('reads "#id" as that node’s world position, and "#id y: 6; z: 8" as it plus an offset', () => {
    class Level extends Scene {
      player = new Mesh(new BoxGeometry(1, 1, 1));
      override onLoad(): void {
        this.player.position.set(2, 1, -3);
        this.add(this.player);
      }
    }
    const scene = new Level();
    scene.onLoad();
    scene.updateMatrixWorld(true);
    expect(anchoredPoint(scene, '#player')!.toArray()).toEqual([2, 1, -3]);
    expect(anchoredPoint(scene, '#player y: 6; z: 8')!.toArray()).toEqual([2, 7, 5]);
    // A plain point is still a plain point, and a wrong id says so rather than framing nothing.
    expect(anchoredPoint(scene, 'y: 6; z: 12')!.toArray()).toEqual([0, 6, 12]);
    expect(() => anchoredPoint(scene, '#nobody')).toThrow(/not an id/);
  });
});

describe('framing a capture', () => {
  it('reads a point, and has no magic values left', () => {
    expect(pointOf('y: 6; z: 12')).toEqual(new Vector3(0, 6, 12));
    expect(pointOf('x: -2')).toEqual(new Vector3(-2, 0, 0));
    // "fit" used to be a viewpoint smuggled through this field. It is a typo now, like any other.
    expect(pointOf('fit')).toBeUndefined();
    expect(pointOf('')).toBeUndefined();
    expect(pointOf('nonsense')).toBeUndefined();
  });
});

/**
 * The observer serves every project through one Vite whose root is the observer's own page. That
 * makes two things easy to get wrong, and a run got both: a dependency cache shared by projects
 * that need different dependencies, and a page still holding URLs the optimizer has replaced.
 *
 * Neither can be exercised without a browser and six real projects, so what is pinned here is the
 * property each fix rests on.
 */
describe('serving more than one project', () => {
  it('files a project’s dependency bundles under that project', () => {
    const a = depCacheDir('/tmp/one');
    const b = depCacheDir('/tmp/two');
    expect(a).not.toBe(b);
    // Stable, so a second run reuses what the first optimized rather than paying for it again.
    expect(depCacheDir('/tmp/one')).toBe(a);
    // And relative or absolute is the same project.
    expect(depCacheDir('/tmp/one/')).toBe(a);
  });

  it('reloads for a stale module only while opening, never under an open scene', () => {
    // A failed `import()` in an agent's `eval` reads exactly like a replaced module. Reloading on
    // it discarded the scene the agent was stepping through and answered "no scene is open".
    const browser = readFileSync(fileURLToPath(new URL('../../packages/observer/src/browser.ts', import.meta.url)), 'utf8');
    expect(browser).toContain("command.type === 'open' && STALE_MODULE.test(answer.error)");
  });

  it('recognises the page saying its modules were replaced underneath it', () => {
    // Both texts are verbatim from the run that lost half an hour to them.
    expect(
      STALE_MODULE.test(
        'Failed to fetch dynamically imported module: http://localhost:59850/@fs/x/main.scene.gen.ts?import&v=1',
      ),
    ).toBe(true);
    expect(STALE_MODULE.test('504 (Outdated Optimize Dep)')).toBe(true);
    // A real failure of the project is not one of these, and must not be retried away.
    expect(STALE_MODULE.test('<Spinner> is not a component in this project.')).toBe(false);
  });
});

/**
 * The server starts whatever the project's documents say.
 *
 * An MCP client spawns this at session start. A throw here took every observer tool with it for
 * the whole session, with the reason on a stderr nobody reads — and the reason was one bad
 * attribute, fixable in ten seconds by an agent that could see it. So the diagnostics become the
 * answer every tool gives until a rebuild succeeds.
 */
describe('a project that does not compile', () => {
  it('is a server that answers with the reason, not a server that failed to start', async () => {
    const fixture = makeFixture('observer-broken');
    try {
      fixture.write('game.ts', `import { Component } from '@scenoco-three/core';\nexport class Mover extends Component {\n  speed = 1;\n}\n`);
      fixture.writeXml('assets/scenes/main.scene.xml', `<Scene>\n  <Group><Components><Mover speed="fast" /></Components></Group>\n</Scene>\n`);

      const server = await startProjectServer({ root: fixture.dir, quiet: true });
      try {
        expect(server.failure).toContain('speed="fast" is not a number');
        // Every tool reads this before it runs, so the first call answers with it.
        expect(server.changed).toBe(true);

        fixture.writeXml('assets/scenes/main.scene.xml', `<Scene>\n  <Group><Components><Mover speed="6" /></Components></Group>\n</Scene>\n`);
        await vi.waitFor(() => expect(server.failure).toBeNull(), { timeout: 15_000, interval: 100 });
      } finally {
        await server.close();
      }
    } finally {
      fixture.dispose();
    }
  }, 120_000);
});
