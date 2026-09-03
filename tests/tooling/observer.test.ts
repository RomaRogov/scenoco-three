import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { anchoredPoint, boxOfAuthored, pointOf } from '../../packages/observer/app/session.js';
import { createMcpServer, startMcpHttp } from '../../packages/observer/src/mcp.js';
import { indexDocument } from '../../packages/compiler/src/index.js';


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

  it('refuses to relens a capture that includes the UI, rather than cropping it', () => {
    // A <Canvas> is a plane parented to the game camera, placed to fill exactly that camera's
    // frustum at *its* fov. Relensing for the shot left the plane where it was, so the HUD came
    // back cropped or missing entirely — a picture of a broken HUD that is not broken.
    expect(session).toContain('usingScene && fov !== undefined && fov !== camera.fov');
    expect(session).toContain("Drop fov to keep the UI");
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

  it('needs nothing but a viewpoint for a capture', async () => {
    // `ui`, `width` and `height` were required once, and the first call every agent made
    // failed on "expected boolean, received undefined at ui". A default each is the whole fix.
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
      expect(tools.find((t) => t.name === 'screenshot')!.inputSchema.required).toEqual(['cameraPos']);
      expect(tools.find((t) => t.name === 'simulate')!.inputSchema.required).toEqual(['steps']);
      // The verbs, as the client will see them. `eval` is the one with hands; it has to be there.
      const steps = tools.find((t) => t.name === 'simulate')!.inputSchema as unknown as {
        properties: { steps: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } };
      };
      const verbs = JSON.stringify(steps.properties.steps.items.oneOf ?? steps.properties.steps.items.anyOf);
      for (const verb of ['"eval"', '"telemetry"', '"preview"', '"step"']) expect(verbs).toContain(verb);
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
