import { Mesh, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CameraRig } from '../../packages/editor/app/cameraRig.js';
import { SceneDocument } from '../../packages/editor/app/document.js';
import { applyEdits, createBridgeCore, type BridgeSocket } from '../../packages/editor/src/server.js';
import type { EditorResponse } from '../../packages/editor/src/protocol.js';
import { indexDocument } from '../../packages/compiler/src/index.js';

/**
 * What the editor writes back.
 *
 * The whole save path is `applyEdits`: the page sends splices addressed by the same line and
 * column the compiler stamped into the live objects, and this turns them into the new file. It is
 * the one place in the editor that can damage someone's source, so it is the one worth pinning
 * down away from a browser.
 */
const DOC = `<!-- Level one. -->
<Scene>
  <PerspectiveCamera id="cam" fov="50" position="z: 8" />

  <Mesh id="ball" geometry="../geometry/ball.geometry.xml">
    <Components>
      <RigidBody2D kind="dynamic" />
      <CircleCollider2D radius="0.4" restitution="0.75" />
    </Components>
  </Mesh>

  <Group id="props" />
</Scene>
`;

const at = (tag: string, source = DOC) => {
  const found = indexDocument(source).find((e) => e.tag === tag)!;
  return { line: found.line, column: found.column };
};

describe('saving', () => {
  it('applies a batch in order and changes nothing else', () => {
    const { text, problems } = applyEdits(DOC, [
      { op: 'setAttribute', at: at('CircleCollider2D'), name: 'restitution', value: '0.95' },
      { op: 'setAttribute', at: at('PerspectiveCamera'), name: 'fov', value: '70' },
    ]);
    expect(problems).toEqual([]);
    expect(text).toContain('restitution="0.95"');
    expect(text).toContain('fov="70"');
    // Everything else, byte for byte — the comment, the blank lines, the indentation.
    expect(text.replace('0.95', '0.75').replace('fov="70"', 'fov="50"')).toBe(DOC);
  });

  it('clears an attribute rather than writing the default over it', () => {
    // A document that says nothing inherits whatever the class decides later; one that writes
    // today's default is pinned to today's value. Clearing has to be its own instruction.
    const { text } = applyEdits(DOC, [
      { op: 'setAttribute', at: at('CircleCollider2D'), name: 'restitution', value: null },
    ]);
    expect(text).toContain('<CircleCollider2D radius="0.4" />');
  });

  it('writes a gizmo drag as one attribute in the document’s own grammar', () => {
    const { text } = applyEdits(DOC, [
      { op: 'setAttribute', at: at('Mesh'), name: 'position', value: 'x: 1.5; y: 2; z: 0' },
    ]);
    expect(text).toContain('position="x: 1.5; y: 2; z: 0"');
  });

  it('reparents, taking the subtree with it', () => {
    const { text, problems } = applyEdits(DOC, [
      { op: 'moveElement', at: at('Mesh'), parent: at('Group') },
    ]);
    expect(problems).toEqual([]);
    const moved = indexDocument(text).find((e) => e.tag === 'Mesh')!;
    expect(moved.parent?.tag).toBe('Group');
    expect(indexDocument(text).map((e) => e.tag)).toContain('CircleCollider2D');
  });

  it('adds a component under the node’s <Components>', () => {
    const { text } = applyEdits(DOC, [
      { op: 'insertChild', at: at('Components'), xml: '<BounceCounter />' },
    ]);
    expect(text).toContain('<BounceCounter />');
    expect(indexDocument(text).find((e) => e.tag === 'BounceCounter')?.parent?.tag).toBe('Components');
  });

  /**
   * The document is left exactly as it was when an edit cannot be placed.
   *
   * A save that half-applied would be worse than one that failed: the page still holds the
   * pending edits, so a refused save costs a retry, while a partial one costs a file.
   */
  it('reports an edit it cannot place, and leaves that edit out', () => {
    const { text, problems } = applyEdits(DOC, [
      { op: 'setAttribute', at: { line: 99, column: 1 }, name: 'fov', value: '70' },
    ]);
    expect(problems[0]).toContain('the document changed');
    expect(text).toBe(DOC);
  });
});

/**
 * Which tab a command goes to, and when the process gives up.
 *
 * An editor is a process attached to a browser tab it does not control: tabs are opened,
 * duplicated, and closed behind its back. These are the rules that keep that from turning into a
 * command sent to a tab nobody is looking at, or a process left holding its ports all day.
 */
describe('the editor and its tabs', () => {
  const OPEN = 1;
  const CLOSED = 3;

  /** A stand-in for an editor page: records what it was sent, and can reply or close. */
  function fakePage() {
    const handlers: { message?: (data: unknown) => void; close?: () => void } = {};
    const sent: string[] = [];
    const socket = {
      readyState: OPEN,
      OPEN,
      send: (data: string) => sent.push(data),
      on: (event: 'message' | 'close', listener: (data: unknown) => void) => {
        handlers[event] = listener as never;
      },
    };
    return {
      socket: socket as unknown as BridgeSocket,
      sent,
      reply: (response: EditorResponse) => handlers.message?.(JSON.stringify(response)),
      close: () => {
        socket.readyState = CLOSED;
        handlers.close?.();
      },
    };
  }

  it('sends a command to the newest tab, and hands it to another when that tab closes', async () => {
    const { bridge, register } = createBridgeCore();
    const first = fakePage();
    const second = fakePage();
    register(first.socket);
    register(second.socket);

    const answer = bridge.send({ id: 'c1', type: 'run' });
    // Newest, because that is the tab the person just opened — the older one is behind it.
    expect(second.sent).toHaveLength(1);
    expect(first.sent).toHaveLength(0);

    second.close(); // closed mid-command: the older tab picks it up rather than the call hanging
    expect(first.sent).toHaveLength(1);

    first.reply({ id: 'c1', ok: true, result: { kind: 'ok' } });
    await expect(answer).resolves.toMatchObject({ ok: true });
  });

  it('rejects a command in flight when the last tab closes', async () => {
    const { bridge, register } = createBridgeCore();
    const page = fakePage();
    register(page.socket);
    const answer = bridge.send({ id: 'c1', type: 'stop' });
    page.close();
    await expect(answer).rejects.toThrow(/closed before answering/);
  });

  it('halts once every tab is gone, and not while one is open', async () => {
    const halted = vi.fn();
    const { register } = createBridgeCore({ onIdle: halted, initialGraceMs: 10_000, idleMs: 20 });
    const page = fakePage();
    register(page.socket);

    await new Promise((done) => setTimeout(done, 40));
    expect(halted).not.toHaveBeenCalled(); // a tab is open — the process has something to serve

    page.close();
    await new Promise((done) => setTimeout(done, 40));
    expect(halted).toHaveBeenCalledTimes(1);
  });
});

/**
 * Framing a node moves the camera without turning it — Unity's F.
 *
 * The angle is the part worth pinning down. It is one line to "helpfully" point the camera at
 * what it just framed, and that line throws away the view the person arranged; the rule is that
 * F answers "put that in front of me" and nothing else.
 */
describe('framing the editor camera', () => {
  const rigAt = (position: [number, number, number], lookAt: Vector3) => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 2000);
    camera.position.set(...position);
    return new CameraRig(camera, lookAt);
  };

  it('keeps the angle and lands `distance` back along it', () => {
    const rig = rigAt([6, 5, 10], new Vector3(0, 0, 0));
    rig.sync();
    const angle = rig.camera.quaternion.clone();
    const forward = new Vector3(0, 0, -1).applyQuaternion(angle);
    const subject = new Vector3(-4, 1.5, 0);

    rig.frameOn(subject, 3);
    for (let frame = 0; frame < 120; frame++) rig.sync(1 / 60); // a couple of seconds of easing

    // Not exactly zero: the rig holds yaw/pitch as an Euler and rebuilds the quaternion from it
    // each frame, which costs ~1e-8 radians in float noise. Anything a person could see would be
    // many orders of magnitude larger.
    expect(rig.camera.quaternion.angleTo(angle)).toBeLessThan(1e-6);
    expect(rig.camera.position.distanceTo(subject)).toBeCloseTo(3, 5);
    // Behind the subject along the view direction, so it lands dead centre of frame.
    expect(rig.camera.position.distanceTo(subject.clone().addScaledVector(forward, -3))).toBeCloseTo(0, 5);
  });

  it('covers the same fraction of the distance per second at any frame rate', () => {
    const subject = new Vector3(-4, 1.5, 0);
    const at60 = rigAt([6, 5, 10], new Vector3());
    const at144 = rigAt([6, 5, 10], new Vector3());
    at60.frameOn(subject, 3);
    at144.frameOn(subject, 3);

    for (let frame = 0; frame < 18; frame++) at60.sync(1 / 60); // 0.3s
    for (let frame = 0; frame < 43; frame++) at144.sync(1 / 144); // 0.3s
    // A per-frame lerp would put the 144Hz camera more than twice as far along by now.
    expect(at60.camera.position.distanceTo(at144.camera.position)).toBeLessThan(0.02);
  });

  it('hands the camera back the moment the person touches the controls', () => {
    const rig = rigAt([6, 5, 10], new Vector3());
    rig.frameOn(new Vector3(-4, 1.5, 0), 3);
    for (let frame = 0; frame < 3; frame++) rig.sync(1 / 60);

    rig.move(0.5, 0, 0); // a keypress, a drag, a pinch — any of them
    const grabbed = rig.camera.position.clone();
    for (let frame = 0; frame < 120; frame++) rig.sync(1 / 60);
    expect(rig.camera.position.distanceTo(grabbed)).toBe(0);
  });
});

/**
 * An edit reaches the live scene, and undo takes it back off.
 *
 * The document is the model and the viewport is the view, and nothing carried the model to the
 * view: typing a position rewrote the XML and left the object where it was, and undoing a gizmo
 * drag rewound the file while the object stayed dragged. Half-applied edits are the reason undo
 * could not be trusted, so both halves are asserted here every time.
 */
describe('an edit and the live object', () => {
  const DOCUMENT = `<Scene>
  <Mesh id="ball" position="x: 1; y: 2; z: 3" />
</Scene>
`;

  /** A document over one live mesh, stamped with the provenance the compiler would have emitted. */
  function open() {
    const elements = indexDocument(DOCUMENT).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const mesh = new Mesh();
    mesh.position.set(1, 2, 3);
    const element = elements.find((e) => e.tag === 'Mesh')!;
    mesh.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument('scene.xml', DOCUMENT, elements, {
      components: [],
      systems: [],
      effects: [],
      tags: [],
    });
    return { doc, mesh };
  }

  it('moves the object, and undo moves it back', () => {
    const { doc, mesh } = open();
    expect(doc.canEditTransform(mesh)).toBe(true);

    mesh.position.set(1, 9, 3); // what a gizmo drag leaves behind
    doc.setTransform(mesh, 'position');
    expect(doc.nodeAttr(mesh, 'position')).toBe('x: 1; y: 9; z: 3');

    doc.undoLast();
    expect(doc.nodeAttr(mesh, 'position')).toBe('x: 1; y: 2; z: 3');
    expect(mesh.position.toArray()).toEqual([1, 2, 3]); // the half that was missing

    doc.redoLast();
    expect(mesh.position.toArray()).toEqual([1, 9, 3]);
  });

  it('writes a typed value through to the object', () => {
    const { doc, mesh } = open();
    doc.setNodeValue(mesh, { name: 'position', type: 'Vector3', shape: 'vector3', required: false }, [4, 5, 6]);
    expect(mesh.position.toArray()).toEqual([4, 5, 6]);
  });
});

/**
 * Undoing a drag returns the object to where the drag started.
 *
 * The trap is a channel the document does not write, which is most of them — a rotation left at
 * zero, a scale left at one. Recording the "before" when the first edit arrives is a frame too
 * late, because the edit exists *because* the object already moved; with no authored text to
 * fall back on, undo would leave the object one frame into the drag. Position hid it: documents
 * usually write a position, so the text restored the object and the stale snapshot never showed.
 */
describe('undoing a gizmo drag', () => {
  const DOCUMENT = `<Scene>
  <Mesh id="ball" position="x: 1; y: 2; z: 3" />
</Scene>
`;

  function open() {
    const elements = indexDocument(DOCUMENT).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const mesh = new Mesh();
    mesh.position.set(1, 2, 3);
    const element = elements.find((e) => e.tag === 'Mesh')!;
    mesh.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument('scene.xml', DOCUMENT, elements, { components: [], systems: [], effects: [], tags: [] });
    return { doc, mesh };
  }

  /** A drag: the pre-drag value is captured once, then reported as the object moves. */
  function drag(doc: SceneDocument, mesh: Mesh, channel: 'eulerAngles' | 'scale', to: number): void {
    const from = (channel === 'eulerAngles' ? mesh.eulerAngles : mesh.scale).clone();
    for (let frame = 1; frame <= 8; frame++) {
      const t = (to * frame) / 8;
      if (channel === 'eulerAngles') mesh.rotation.z = t;
      else mesh.scale.setScalar(t);
      doc.setTransform(mesh, channel, { coalesce: true, from });
    }
  }

  it('puts an unwritten rotation back to exactly where it was', () => {
    const { doc, mesh } = open();
    expect(doc.nodeAttr(mesh, 'eulerAngles')).toBeUndefined(); // nothing to fall back on

    drag(doc, mesh, 'eulerAngles', 0.8);
    expect(mesh.eulerAngles.z).toBeGreaterThan(45);

    doc.undoLast();
    expect(mesh.eulerAngles.z).toBe(0);
    expect(doc.nodeAttr(mesh, 'eulerAngles')).toBeUndefined();
  });

  it('puts an unwritten scale back to exactly where it was', () => {
    const { doc, mesh } = open();
    drag(doc, mesh, 'scale', 2.4);
    expect(mesh.scale.x).toBeCloseTo(2.4, 5);

    doc.undoLast();
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('records one undo step for a whole drag', () => {
    const { doc, mesh } = open();
    drag(doc, mesh, 'scale', 2);
    doc.undoLast();
    expect(doc.canUndo).toBe(false); // eight writes, one step
  });
});
