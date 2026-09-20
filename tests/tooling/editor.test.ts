import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraRig } from '../../packages/editor/app/cameraRig.js';
import { ConfigDocument } from '../../packages/editor/app/config.js';
import { SceneDocument } from '../../packages/editor/app/document.js';
import { projectModelAt } from '../../packages/editor/app/host.js';
import { applyEdits } from '../../packages/editor/app/live/edits.js';
import { buildLive } from '../../packages/editor/app/live/build.js';
import { joinPath, type Source } from '../../packages/editor/app/live/source.js';
import { indexDocument as indexInBrowser } from '../../packages/compiler/src/browser.js';
import { build } from '../../packages/compiler/src/index.js';
import { SceneManager } from '@scenoco-three/core';
import * as THREE from 'three';
import { makeFixture } from '../compiler/fixture.js';
import { resetEngine } from '../core/helpers.js';
import { indexDocument, type PropInfo } from '../../packages/compiler/src/index.js';

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

  <Mesh id="ball" geometry="../geometry/ball.asset.xml">
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

  it('finds every element an edit names after an earlier splice has moved the text under it', () => {
    // Every position is where the element stood when the file was opened — what the live objects
    // are stamped with. A component added to the first node pushes the rest down three lines.
    const { text, problems } = applyEdits(DOC, [
      { op: 'insertChild', at: at('PerspectiveCamera'), xml: '<Components>\n  <CameraFit />\n</Components>' },
      { op: 'setAttribute', at: at('CircleCollider2D'), name: 'restitution', value: '0.95' },
      { op: 'moveElement', at: at('Mesh'), parent: at('Group') },
      { op: 'setAttribute', at: at('Group'), name: 'name', value: 'props' },
    ]);
    expect(problems).toEqual([]);
    const index = indexDocument(text);
    expect(index.find((e) => e.tag === 'CameraFit')?.parent?.parent?.tag).toBe('PerspectiveCamera');
    expect(index.find((e) => e.tag === 'CircleCollider2D')?.attributes.restitution).toBe('0.95');
    expect(index.find((e) => e.tag === 'Mesh')?.parent?.attributes.name).toBe('props');
    expect(text).not.toContain('scenoco-edit-target');
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

  it('puts the object a reference names on the node, never the path, and undo puts the shared one back', async () => {
    const { mesh } = open();
    const shared = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const other = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    mesh.material = shared;
    const elements = indexDocument(DOCUMENT).map((e) => ({ ...e, attributes: e.attributes }));
    const doc = new SceneDocument(
      'scene.xml',
      DOCUMENT,
      elements,
      { components: [], systems: [], effects: [], tags: [] },
      { resolve: async (_name, _shape, text) => (text === 'blue.asset.xml' ? other : shared) },
    );
    const material: PropInfo = { name: 'material', type: 'Material', shape: 'assetRef', required: false };

    doc.setNodeValue(mesh, material, 'blue.asset.xml');
    // A path in the slot is a string three draws with, and the next frame throws.
    expect(mesh.material).toBe(shared);
    await Promise.resolve();
    expect(mesh.material).toBe(other);

    doc.undoLast();
    // The shared material comes back as itself — not `other`, overwritten with a copy of its look.
    expect(mesh.material).toBe(shared);
    expect(other.color.getHex()).toBe(0x0000ff);
  });
});

/**
 * Components, as the document writes them.
 *
 * The editor runs nothing, so there is no component instance to ask: what a node has is what its
 * element declares, and what each one takes is what the build read from the class.
 */
describe('components in the inspector', () => {
  const SOURCE = `<Scene>
  <Mesh id="ball">
    <MeshStandardMaterial color="#ff0000" />
    <Components>
      <Spin speed="2" />
      <Mystery label="hello" />
    </Components>
    <Mesh id="child">
      <Components>
        <Spin />
      </Components>
    </Mesh>
  </Mesh>
  <Group id="empty" />
</Scene>
`;
  const number = (name: string): PropInfo => ({ name, type: 'number', shape: 'number', required: false });

  function open() {
    const elements = indexDocument(SOURCE).map((e) => ({ ...e, attributes: e.attributes }));
    const stamped = (id: string) => {
      const element = elements.find((e) => e.attributes.id === id)!;
      const node = new THREE.Object3D();
      node.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
      return node;
    };
    const doc = new SceneDocument('scene.xml', SOURCE, elements, {
      components: [
        { name: 'Spin', file: 'src/Spin.ts', line: 1, fields: [{ ...number('speed'), explicit: false }] },
      ],
      systems: [],
      effects: [],
      tags: [{ name: 'Mesh', family: 'node', module: 'three', bases: ['Object3D'], parameters: [], properties: [] }],
    });
    return { doc, ball: stamped('ball'), empty: stamped('empty') };
  }
  const save = (doc: SceneDocument) => applyEdits(SOURCE, doc.edits());

  it('comes from the build of the project the document is in — the nearest model at or above it', async () => {
    const model = (name: string) => JSON.stringify({ components: [{ name }], systems: [], effects: [], tags: [] });
    const files: Record<string, string> = {
      '.scenoco/model.json': model('Outer'),
      'game/.scenoco/model.json': model('Inner'),
      // What a static host answers for a path it does not have: its index page, not a 404.
      'game/assets/.scenoco/model.json': '<!doctype html><title>editor</title>',
    };
    const source: Source = {
      label: 'folder',
      read: async (path) => files[path] ?? Promise.reject(new Error(`${path}: not found`)),
      url: async (path) => path,
      resolve: (from, ref) => joinPath(from.split('/').slice(0, -1).join('/'), ref),
    };
    expect((await projectModelAt(source, 'game/assets/scenes/main.scene.xml'))?.components[0]?.name).toBe('Inner');
    expect((await projectModelAt(source, 'other/main.scene.xml'))?.components[0]?.name).toBe('Outer');
    delete files['.scenoco/model.json'];
    expect(await projectModelAt(source, 'other/main.scene.xml')).toBeNull();
  });

  it('reads them from the element — its own block, past an inline material, not a child node’s', () => {
    const { doc, ball } = open();
    const entries = doc.componentsOf(ball);
    expect(entries.map((e) => e.tag)).toEqual(['Spin', 'Mystery']);
    expect(entries[0]!.info?.fields.map((f) => f.name)).toEqual(['speed']);
    expect(doc.componentProp(entries[0]!, 'speed')).toBe('2');
    // A class this project's model does not know is still there, with its attributes as written.
    expect(entries[1]!.info).toBeUndefined();
    expect(entries[1]!.attributes.get('label')).toBe('hello');
  });

  it('writes an attribute into the element, and undo takes it back', () => {
    const { doc, ball } = open();
    doc.setComponentValue(doc.componentsOf(ball)[0]!, number('speed'), 5);
    expect(doc.componentProp(doc.componentsOf(ball)[0]!, 'speed')).toBe('5');
    expect(save(doc).text).toContain('<Spin speed="5" />');
    doc.undoLast();
    expect(doc.componentProp(doc.componentsOf(ball)[0]!, 'speed')).toBe('2');
  });

  it('shows a component added since opening, whose attributes go into the insert that writes it', () => {
    const { doc, ball, empty } = open();
    doc.addComponent(empty, 'Spin');
    doc.addComponent(empty, 'Mystery');
    const [spin] = doc.componentsOf(empty);
    expect(doc.componentsOf(empty).map((e) => e.tag)).toEqual(['Spin', 'Mystery']);
    doc.setComponentValue(spin!, number('speed'), 3);
    // A node below the insert, edited after it: the save still finds its element.
    doc.addComponent(ball, 'Spin');

    const { text, problems } = save(doc);
    expect(problems).toEqual([]);
    expect(text).toContain(`<Group id="empty">
    <Components>
      <Spin speed="3" />
      <Mystery />
    </Components>
  </Group>`);
    // Into the block the ball already has, not a second one.
    expect(text.match(/<Components>/g)).toHaveLength(3);

    doc.undoLast(); // the ball's Spin
    doc.undoLast(); // speed
    doc.undoLast(); // Mystery
    expect(doc.componentsOf(empty).map((e) => [e.tag, e.attributes.get('speed')])).toEqual([['Spin', undefined]]);
    doc.undoLast();
    expect(doc.componentsOf(empty)).toEqual([]);
    expect(doc.edits()).toEqual([]);
  });

  it('removes one, and undo brings it back without taking a later write with it', () => {
    const { doc, ball } = open();
    doc.removeComponent(doc.componentsOf(ball)[1]!);
    expect(doc.componentsOf(ball).map((e) => e.tag)).toEqual(['Spin']);
    doc.setComponentValue(doc.componentsOf(ball)[0]!, number('speed'), 7);
    expect(save(doc).text).not.toContain('Mystery');

    doc.undoLast(); // speed
    doc.undoLast(); // the removal
    expect(doc.componentsOf(ball).map((e) => e.tag)).toEqual(['Spin', 'Mystery']);
    expect(save(doc).text).toContain('<Mystery label="hello" />');
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

/**
 * The standalone editor has no compiler behind it: it builds the scene from the XML, with the
 * compiler's parser and the compiler's model, so what it shows is what the generated module
 * would have built. Pinned here on the things a person edits — nodes, references, placement,
 * a prefab and its override — and on the provenance stamps, which are what selection and the
 * inspector find an element by.
 */
describe('the standalone editor builds a scene from XML', () => {
  afterEach(resetEngine);

  it('constructs nodes with their assets, places them, resolves ids, spawns a prefab with an override', async () => {
    const fixture = makeFixture('live');
    try {
      fixture.write('game.ts', "import 'three';\nexport {};\n"); // the vocabulary is read through a real import
      const { model } = build({ root: fixture.dir, dryRun: true });
      const files: Record<string, string> = {
        'assets/geometry/cube.asset.xml': '<BoxGeometry width="1" height="1" depth="1" />',
        'assets/materials/red.asset.xml': '<MeshStandardMaterial color="#ff0000" roughness="0.5" />',
        'assets/scenes/crate.prefab.xml':
          '<Mesh id="body" geometry="../geometry/cube.asset.xml" material="../materials/red.asset.xml" scale="0.5" />',
        'assets/scenes/main.scene.xml': `<Scene camera="#cam" background="#0b1120">
  <PerspectiveCamera id="cam" fov="45" position="y: 3; z: 7" />
  <Mesh id="player" geometry="../geometry/cube.asset.xml" material="../materials/red.asset.xml"
        position="x: 1; y: 0.5" eulerAngles="y: 90" scale="2" />
  <Mesh id="own">
    <SphereGeometry radius="0.5" />
    <MeshStandardMaterial color="#00ff00" roughness="0.2" />
  </Mesh>
  <Prefab src="crate.prefab.xml" id="crate1" position="x: 3">
    <Override target="#body" scale="0.25" />
  </Prefab>
</Scene>`,
      };
      const source: Source = {
        label: 'memory',
        read: async (path) => {
          if (!(path in files)) throw new Error(`no ${path}`);
          return files[path]!;
        },
        url: async (path) => path,
        resolve: (from, ref) => joinPath(from.split('/').slice(0, -1).join('/'), ref),
      };
      const live = await buildLive('assets/scenes/main.scene.xml', source, model, { ...THREE });
      expect(live.problems).toEqual([]);

      const scene = await SceneManager.load(live.SceneClass);
      const player = scene.byId('player', THREE.Mesh)!;
      expect(player).toBeInstanceOf(THREE.Mesh);
      expect(player.geometry).toBeInstanceOf(THREE.BoxGeometry);
      expect((player.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
      expect(player.position.toArray()).toEqual([1, 0.5, 0]);
      expect(Math.round(player.eulerAngles.y)).toBe(90);
      expect(player.scale.toArray()).toEqual([2, 2, 2]);
      // An object written inside the node is a constructor argument, not a child of it.
      const own = scene.byId('own', THREE.Mesh)!;
      expect(own.children).toEqual([]);
      expect(own.geometry).toBeInstanceOf(THREE.SphereGeometry);
      expect((own.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00');
      expect((own.material as THREE.MeshStandardMaterial).roughness).toBe(0.2);
      expect(own.material).not.toBe(player.material);

      expect(scene.mainCamera).toBe(scene.byId('cam'));
      expect((scene.background as THREE.Color).getHexString()).toBe('0b1120');

      // The spawn: a real Mesh from the prefab document, placed by the spawn, overridden inside.
      const crate = scene.byId('crate1', THREE.Mesh)!;
      expect(crate.position.x).toBe(3);
      expect(crate.scale.x).toBe(0.25);
      // A shared asset is one instance, as the compiler's shared module is.
      expect(crate.geometry).toBe(player.geometry);

      // Provenance is the parser's own position, so the element index finds it.
      const index = indexInBrowser(files['assets/scenes/main.scene.xml']!);
      const stamped = player.userData.scenoco as { file: string; line: number; column: number };
      const element = index.find((e) => e.line === stamped.line && e.column === stamped.column)!;
      expect(element.tag).toBe('Mesh');
      expect(stamped.file).toBe('assets/scenes/main.scene.xml');
    } finally {
      fixture.dispose();
    }
  }, 120_000);

  it('keeps an unknown element in the tree and says why, rather than dropping it', async () => {
    const fixture = makeFixture('live-unknown');
    try {
      fixture.write('game.ts', "import 'three';\nexport {};\n");
      const { model } = build({ root: fixture.dir, dryRun: true });
      const source: Source = {
        label: 'memory',
        read: async () => '<Scene><Bogus id="x" /></Scene>',
        url: async (p) => p,
        resolve: (_f, r) => r,
      };
      const live = await buildLive('a.scene.xml', source, model, { ...THREE });
      const scene = await SceneManager.load(live.SceneClass);
      expect(scene.byId('x')).toBeInstanceOf(THREE.Object3D);
      expect(live.problems[0]).toMatch(/<Bogus> is not a node/);
    } finally {
      fixture.dispose();
    }
  }, 120_000);
});

/**
 * An object written *inside* a node — the material a mesh has of its own.
 *
 * It never becomes a node, so nothing in the tree selects it; the inspector reaches it through
 * the node whose constructor took it, and the slot it fills stops being writable as an attribute.
 */
describe('an attached object', () => {
  const DOCUMENT = `<Scene>
  <Mesh id="ball">
    <MeshStandardMaterial color="#ff0000" roughness="0.5" />
  </Mesh>
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
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5 });
    const mesh = new Mesh(new BoxGeometry(), material);
    const element = elements.find((e) => e.tag === 'Mesh')!;
    mesh.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument('scene.xml', DOCUMENT, elements, {
      components: [],
      systems: [],
      effects: [],
      tags: [
        {
          name: 'Mesh',
          family: 'node',
          module: 'three',
          bases: ['Object3D'],
          parameters: [
            { name: 'geometry', type: 'BufferGeometry', shape: 'assetRef', assetFamily: 'geometry', required: false },
            { name: 'material', type: 'Material', shape: 'assetRef', assetFamily: 'material', list: true, required: false },
          ],
          properties: [],
        },
        {
          name: 'MeshStandardMaterial',
          family: 'material',
          module: 'three',
          bases: ['Material'],
          parameters: [],
          properties: [
            { name: 'color', type: 'Color', shape: 'color', required: false },
            { name: 'roughness', type: 'number', shape: 'number', required: false },
          ],
        },
      ],
    },
    // What the live builder does: construct the tag with nothing written on it. Removing an
    // attachment asks it for a bare `<Mesh>` and takes what three put in the slot.
    { construct: async (tag) => (tag.name === 'Mesh' ? new Mesh(new BoxGeometry()) : new THREE.MeshStandardMaterial()) },
    );
    return { doc, mesh, material };
  }

  it('is found under the node whose constructor takes it, with the slot it fills', () => {
    const { doc, mesh, material } = open();
    const [attached] = doc.attachmentsOf(mesh);
    expect(attached?.tag.name).toBe('MeshStandardMaterial');
    expect(attached?.slot).toBe('material');
    expect(attached?.live).toBe(material);
    expect(attached?.attributes.get('color')).toBe('#ff0000');
  });

  it('writes through to the object it built, and undo puts it back', () => {
    const { doc, mesh, material } = open();
    const attached = doc.attachmentsOf(mesh)[0]!;
    const roughness: PropInfo = { name: 'roughness', type: 'number', shape: 'number', required: false };

    doc.setAttachmentValue(attached, roughness, 0.9);
    expect(material.roughness).toBe(0.9);
    expect(doc.attachmentsOf(mesh)[0]!.attributes.get('roughness')).toBe('0.9');

    doc.undoLast();
    expect(material.roughness).toBe(0.5);
    expect(doc.attachmentsOf(mesh)[0]!.attributes.get('roughness')).toBe('0.5');
  });

  it('rebuilds a geometry whose constructor argument changed, and undo puts the old one back', () => {
    const source = `<Scene>
  <Mesh id="ring">
    <TorusGeometry radius="0.5" tube="0.2" />
  </Mesh>
</Scene>
`;
    const elements = indexDocument(source).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const geometry = new THREE.TorusGeometry(0.5, 0.2);
    const mesh = new Mesh(geometry);
    const element = elements.find((e) => e.tag === 'Mesh')!;
    mesh.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const number = (name: string): PropInfo => ({ name, type: 'number', shape: 'number', required: false });
    const doc = new SceneDocument('scene.xml', source, elements, {
      components: [],
      systems: [],
      effects: [],
      tags: [
        {
          name: 'Mesh',
          family: 'node',
          module: 'three',
          bases: ['Object3D'],
          parameters: [{ name: 'geometry', type: 'BufferGeometry', shape: 'assetRef', assetFamily: 'geometry', required: false }],
          properties: [],
        },
        {
          name: 'TorusGeometry',
          family: 'geometry',
          module: 'three',
          bases: ['BufferGeometry'],
          parameters: [number('radius'), number('tube')],
          properties: [],
        },
      ],
    });

    // three reads `radius` once, in the constructor, so writing it onto the object shows nothing.
    doc.setAttachmentValue(doc.attachmentsOf(mesh)[0]!, number('radius'), 1);
    expect(mesh.geometry).not.toBe(geometry);
    expect((mesh.geometry as THREE.TorusGeometry).parameters).toMatchObject({ radius: 1, tube: 0.2 });
    expect(doc.attachmentsOf(mesh)[0]!.live).toBe(mesh.geometry);

    doc.undoLast();
    expect(mesh.geometry).toBe(geometry);
  });

  it('does not mistake a nested node’s material for this one’s', () => {
    const nested = `<Scene>
  <Group id="holder">
    <Mesh id="ball">
      <MeshStandardMaterial color="#ff0000" />
    </Mesh>
  </Group>
</Scene>
`;
    const elements = indexDocument(nested).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const group = new THREE.Group();
    const element = elements.find((e) => e.tag === 'Group')!;
    group.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument('scene.xml', nested, elements, {
      components: [],
      systems: [],
      effects: [],
      tags: [{ name: 'Group', family: 'node', module: 'three', bases: ['Object3D'], parameters: [], properties: [] }],
    });
    expect(doc.attachmentsOf(group)).toEqual([]);
  });

  /**
   * Adding one, which is the half that was missing: the document could hold an inline material and
   * there was no way to write one but by hand.
   */
  it('can be added to an empty slot, and shows before the file says it', async () => {
    const source = `<Scene>
  <Mesh id="ball" />
</Scene>
`;
    const elements = indexDocument(source).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const mesh = new Mesh(new BoxGeometry());
    const built = new THREE.MeshStandardMaterial();
    const element = elements.find((e) => e.tag === 'Mesh')!;
    mesh.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument(
      'scene.xml',
      source,
      elements,
      {
        components: [],
        systems: [],
        effects: [],
        tags: [
          {
            name: 'Mesh',
            family: 'node',
            module: 'three',
            bases: ['Object3D'],
            parameters: [
              { name: 'material', type: 'Material', shape: 'assetRef', assetFamily: 'material', required: false },
            ],
            properties: [],
          },
          {
            name: 'MeshStandardMaterial',
            family: 'material',
            module: 'three',
            bases: ['Material'],
            parameters: [],
            properties: [{ name: 'color', type: 'Color', shape: 'color', required: false }],
          },
        ],
      },
      { construct: async () => built },
    );

    expect(doc.slotsOf(mesh).map((s) => s.name)).toEqual(['material']);
    const before = mesh.material;
    await doc.addAttachment(mesh, 'MeshStandardMaterial');

    // In the slot at once, and in the file as one insert.
    expect(mesh.material).toBe(built);
    expect(doc.edits()).toEqual([
      { op: 'insertChild', at: { line: element.line, column: element.column }, xml: '<MeshStandardMaterial />', index: 0 },
    ]);

    // Editable before it is saved: the attribute goes into the insert that will write it.
    const color: PropInfo = { name: 'color', type: 'Color', shape: 'color', required: false };
    doc.setAttachmentValue(doc.attachmentsOf(mesh)[0]!, color, 0xff0055);
    expect(doc.edits()[0]).toMatchObject({ xml: '<MeshStandardMaterial color="#ff0055" />' });

    doc.undoLast();
    doc.undoLast();
    expect(doc.edits()).toEqual([]);
    expect(mesh.material).toBe(before);
  });

  /** Taking a written one out puts back what three itself would have built. */
  it('falls back to three’s own default when removed', async () => {
    const { doc, mesh } = open();
    await doc.removeAttachment(doc.attachmentsOf(mesh)[0]!);
    expect(doc.attachmentsOf(mesh)).toEqual([]);
    expect((mesh.material as THREE.Material).type).toBe('MeshBasicMaterial');
  });
});

/**
 * A document that is one typed value — a `.particle.xml` — edited as a form.
 *
 * The editor knows nothing about the kind: the shape below is what a build wrote into the model
 * after reading the declaring package's own TypeScript, and the form, the widgets and these
 * splices all come from it. So the test declares a shape and asserts what the file ends up saying.
 */
describe('a config document', () => {
  /** Stands in for what `scenoco build` puts in `.scenoco/model.json`. */
  const number = (name: string): PropInfo => ({ name, type: 'number', shape: 'number', required: false });
  const KIND = {
    kind: 'particle',
    extension: '.particle.xml',
    dir: 'assets/vfx',
    description: 'A particle effect',
    module: '@acme/vfx',
    shape: {
      name: 'ParticleEffect',
      fields: [number('duration')],
      groups: {
        emission: {
          name: 'Emission',
          fields: [number('rateOverTime')],
          groups: {},
          lists: { bursts: { name: 'Burst', fields: [number('count'), number('time')], groups: {}, lists: {} } },
        },
      },
      lists: {},
    },
  };

  const SOURCE = `<ParticleEffect duration="2">
  <Emission rateOverTime="90" />
</ParticleEffect>
`;

  const saved = (doc: ConfigDocument, text = SOURCE): string => applyEdits(text, doc.edits()).text;

  it('writes an attribute of the element the form is showing', () => {
    const doc = new ConfigDocument('fire.particle.xml', SOURCE, KIND);
    const emission = doc.childrenOf(doc.root!, KIND.shape.groups.emission)[0]!;
    doc.setValue(emission, number('rateOverTime'), 120);
    expect(saved(doc)).toContain('<Emission rateOverTime="120" />');
  });

  it('adds an element the document had not written, named after its type', () => {
    const doc = new ConfigDocument('fire.particle.xml', SOURCE, KIND);
    const emission = doc.childrenOf(doc.root!, KIND.shape.groups.emission)[0]!;
    doc.add(emission, KIND.shape.groups.emission.lists.bursts);
    expect(saved(doc)).toContain('<Burst />');
  });

  /**
   * An element added a moment ago has no position in the file to address, so its attributes go
   * into the one splice that inserts it — the whole subtree written at once.
   */
  it('carries an added element’s attributes into the splice that inserts it', () => {
    const doc = new ConfigDocument('fire.particle.xml', SOURCE, KIND);
    const emission = doc.childrenOf(doc.root!, KIND.shape.groups.emission)[0]!;
    doc.add(emission, KIND.shape.groups.emission.lists.bursts);
    const burst = doc.childrenOf(emission, KIND.shape.groups.emission.lists.bursts)[0]!;
    doc.setValue(burst, number('count'), 24);
    doc.setValue(burst, number('time'), 0);
    expect(doc.edits()).toHaveLength(1);
    expect(saved(doc)).toContain('<Burst count="24" time="0" />');
  });

  it('takes an element back out', () => {
    const doc = new ConfigDocument('fire.particle.xml', SOURCE, KIND);
    const emission = doc.childrenOf(doc.root!, KIND.shape.groups.emission)[0]!;
    doc.remove(emission);
    expect(saved(doc)).not.toContain('<Emission');
  });

  it('undoes a write back to what the file said', () => {
    const doc = new ConfigDocument('fire.particle.xml', SOURCE, KIND);
    doc.setValue(doc.root!, number('duration'), 5);
    expect(saved(doc)).toContain('duration="5"');
    doc.undoLast();
    expect(saved(doc)).toBe(SOURCE);
    expect(doc.canRedo).toBe(true);
  });

  it('refuses a document rooted at the wrong element, saying which is wanted', () => {
    const doc = new ConfigDocument('fire.particle.xml', '<Emitter />\n', KIND);
    expect(doc.root).toBeNull();
    expect(doc.problem).toContain('<ParticleEffect>');
  });
});

/**
 * The same config, written inside the component that plays it.
 *
 * A field typed by a document kind has two forms — a path naming a file every emitter shares, and
 * an element giving this one its own — and the second is edited by the form the `.particle.xml`
 * gets, over the same shape, through the scene's own undo log.
 */
describe('a config inside a component', () => {
  const number = (name: string): PropInfo => ({ name, type: 'number', shape: 'number', required: false });
  const SHAPE = {
    name: 'ParticleEffect',
    fields: [number('duration'), number('startSize')],
    groups: { emission: { name: 'Emission', fields: [number('rateOverTime')], groups: {}, lists: {} } },
    lists: {},
  };
  const MODEL = {
    components: [
      {
        name: 'ParticleSystem',
        file: 'particles.ts',
        line: 1,
        fields: [
          { name: 'effect', type: 'ParticleEffect', shape: 'assetRef' as const, document: 'ParticleEffect', required: true, explicit: false },
        ],
      },
    ],
    systems: [],
    effects: [],
    tags: [{ name: 'Group', family: 'node' as const, module: 'three', bases: ['Object3D'], parameters: [], properties: [] }],
    documents: [
      {
        kind: 'particle',
        extension: '.particle.xml',
        dir: 'assets/vfx',
        description: 'A particle effect',
        module: '@acme/vfx',
        shape: SHAPE,
      },
    ],
  };

  const SOURCE = `<Scene>
  <Group id="glow">
    <Components>
      <ParticleSystem>
        <ParticleEffect duration="3">
          <Emission rateOverTime="20" />
        </ParticleEffect>
      </ParticleSystem>
    </Components>
  </Group>
</Scene>
`;

  function open(source = SOURCE) {
    const elements = indexDocument(source).map((e) => ({
      tag: e.tag,
      line: e.line,
      column: e.column,
      start: e.start,
      end: e.end,
      attributes: e.attributes,
    }));
    const group = new THREE.Group();
    const element = elements.find((e) => e.tag === 'Group')!;
    group.userData.scenoco = { file: 'scene.xml', line: element.line, column: element.column };
    const doc = new SceneDocument('scene.xml', source, elements, MODEL);
    return { doc, group, entry: doc.componentsOf(group)[0]! };
  }

  it('is found against the shape the package declared, as the element the field is named by', () => {
    const { doc, entry } = open();
    const [config] = doc.configsOf(entry);
    expect(config?.prop.name).toBe('effect');
    expect(config?.shape.name).toBe('ParticleEffect');
    expect(config?.node?.attributes.get('duration')).toBe('3');
  });

  it('edits through the scene’s own log, and tells whatever draws the node', () => {
    const { doc, group, entry } = open();
    const touched: string[] = [];
    doc.onComponentEdit = (node) => touched.push(node.uuid);
    const host = doc.configHost(entry);
    const config = doc.configsOf(entry)[0]!;

    host.setValue(config.node!, number('startSize'), 2.5);
    expect(applyEdits(SOURCE, doc.edits()).text).toContain('<ParticleEffect duration="3" startSize="2.5">');
    expect(touched).toEqual([group.uuid]);

    doc.undoLast();
    expect(doc.edits()).toEqual([]);
  });

  it('reaches a preview as a value, with what has been added but not saved', () => {
    const { doc, entry } = open();
    const host = doc.configHost(entry);
    const config = doc.configsOf(entry)[0]!;
    const emission = host.childrenOf(config.node!, SHAPE.groups.emission)[0]!;
    host.setValue(emission, number('rateOverTime'), 90);

    // What the preview is handed: the element, current, with no file to read.
    const [effect] = doc.configElementsOf(entry);
    expect(effect?.tag).toBe('ParticleEffect');
    expect(effect?.children.map((c) => c.tag)).toEqual(['Emission']);
    expect(effect?.children[0]?.attributes.get('rateOverTime')).toBe('90');
  });

  it('is offered where the component writes nothing, and added as one insert', () => {
    const empty = `<Scene>
  <Group id="glow">
    <Components>
      <ParticleSystem />
    </Components>
  </Group>
</Scene>
`;
    const { doc, entry } = open(empty);
    expect(doc.configsOf(entry)[0]?.node).toBeNull();

    doc.addConfig(entry, SHAPE);
    expect(doc.configsOf(entry)[0]?.node).not.toBeNull();

    // Editable before the save, and written as one element with everything inside it.
    const host = doc.configHost(entry);
    host.setValue(doc.configsOf(entry)[0]!.node!, number('duration'), 4);
    host.add(doc.configsOf(entry)[0]!.node!, SHAPE.groups.emission);
    const text = applyEdits(empty, doc.edits()).text;
    expect(text).toContain('<ParticleEffect duration="4">');
    expect(text).toContain('<Emission />');
  });
});
