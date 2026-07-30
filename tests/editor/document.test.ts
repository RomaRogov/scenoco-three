import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, getAttachmentDef, type Component, type CompiledScene, type SceneGraph } from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import { applyStructuralOps, bundleScene, compileSceneXml, patchSceneXml } from '@scenoco-three/compiler';
import { SceneDocument } from '../../packages/editor/app/document.js';
import { applySaveOps, toCompilerStructuralOps } from '../../packages/editor/src/structuralOps.js';
import { Rotator } from '../fixtures/components/Rotator.js';

const colorOf = (mesh: Object3D): number =>
  ((mesh as Mesh).material as unknown as { color: { getHex(): number } }).color.getHex();

/** A minimal scene graph: one node with a Rotator, mirroring what the engine exposes. */
function makeGraph(): { graph: SceneGraph; node: Object3D; rotator: Component } {
  const node = new Object3D();
  node.position.set(0, 1, 0);
  const rotator = new Rotator();
  rotator.node = node;
  const compiled: CompiledScene = {
    root: 0,
    nodes: [{
      tag: 'Object3D', parent: -1, children: [],
      transform: { position: [0, 1, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true },
      attrs: {}, attachments: [], components: [0],
    }],
    attachments: [],
    components: [{ type: 'Rotator', node: 0, props: {} }],
  };
  return { node, rotator, graph: { compiled, nodeByIndex: [node], nodeIndexOf: new Map([[node, 0]]), componentIndexOf: new Map([[rotator, 0]]) } };
}

describe('SceneDocument — stateful edits', () => {
  it('applies a transform to the live object, tracks it as a net edit, and undo/redo restores state', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    expect(doc.isDirty).toBe(false);

    doc.setTransform(node, 'position', [5, 1, 0]);
    expect(node.position.toArray()).toEqual([5, 1, 0]);
    expect(doc.isDirty).toBe(true);
    // The id-less node is addressed by structural path ([] = the root) + tag.
    expect(doc.netEdits()).toEqual([
      { target: { kind: 'node', nodeIndex: 0, path: [], tag: 'Object3D' }, attr: 'position', value: [5, 1, 0] },
    ]);

    doc.undoLast();
    expect(node.position.toArray()).toEqual([0, 1, 0]);
    expect(doc.netEdits()).toEqual([]);
    doc.redoLast();
    expect(node.position.toArray()).toEqual([5, 1, 0]);
  });

  it('coalesces a scrub/drag (same node + channel) into one undo step', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setTransform(node, 'position', [1, 1, 0], { coalesce: true });
    doc.setTransform(node, 'position', [2, 1, 0], { coalesce: true });
    doc.setTransform(node, 'position', [3, 1, 0], { coalesce: true });
    expect(doc.netEdits()).toEqual([
      { target: { kind: 'node', nodeIndex: 0, path: [], tag: 'Object3D' }, attr: 'position', value: [3, 1, 0] },
    ]);
    doc.undoLast(); // one undo rewinds the whole gesture
    expect(node.position.toArray()).toEqual([0, 1, 0]);
    expect(doc.canUndo).toBe(false);
  });

  it('addresses an id-less child node by structural path', () => {
    const root = new Object3D();
    const child = new Object3D();
    const compiled: CompiledScene = {
      root: 0,
      nodes: [
        {
          tag: 'Scene', parent: -1, children: [1],
          transform: { position: [0, 0, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true },
          attrs: {}, attachments: [], components: [],
        },
        {
          tag: 'Mesh', parent: 0, children: [],
          transform: { position: [0, 0, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true },
          attrs: {}, attachments: [], components: [],
        },
      ],
      attachments: [],
      components: [],
    };
    const graph: SceneGraph = {
      compiled,
      nodeByIndex: [root, child],
      nodeIndexOf: new Map([[root, 0], [child, 1]]),
      componentIndexOf: new Map(),
    };
    const doc = new SceneDocument(graph);
    doc.setTransform(child, 'position', [2, 0, 0]);
    expect(doc.netEdits()).toEqual([
      { target: { kind: 'node', nodeIndex: 1, path: [0], tag: 'Mesh' }, attr: 'position', value: [2, 0, 0] },
    ]);
  });

  it('edits a component property and emits a component-addressed net edit', () => {
    const { graph, rotator } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setComponentProp(rotator, 'speed', 5);
    expect((rotator as unknown as { speed: number }).speed).toBe(5);
    expect(doc.netEdits()).toEqual([
      { target: { kind: 'component', componentIndex: 0, nodeIndex: 0, nodePath: [], type: 'Rotator', ordinal: 0 }, attr: 'speed', value: 5 },
    ]);
    doc.undoLast();
    expect((rotator as unknown as { speed: number }).speed).toBe(1);
  });
});

/** Two meshes sharing one pooled MeshStandardMaterial (white) + scene provenance. */
function makeSharedMaterialGraph(): { graph: SceneGraph; provenance: SceneProvenance; a: Object3D; b: Object3D } {
  const a = new Mesh();
  const b = new Mesh();
  const inst = getAttachmentDef('MeshStandardMaterial')!.make({ color: 0xffffff });
  inst.attach({ node: a });
  inst.attach({ node: b });
  const meshNode = (): CompiledScene['nodes'][number] => ({
    tag: 'Mesh', parent: -1, children: [],
    transform: { position: [0, 0, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true },
    attrs: {}, attachments: [0], components: [],
  });
  const compiled: CompiledScene = {
    root: 0,
    nodes: [{ ...meshNode(), id: 'a' }, { ...meshNode(), id: 'b' }],
    attachments: [{ tag: 'MeshStandardMaterial', attrs: { color: 0xffffff } }],
    components: [],
  };
  return {
    a, b,
    provenance: { nodes: [{ kind: 'scene' }, { kind: 'scene' }], attachments: [null] },
    graph: { compiled, nodeByIndex: [a, b], nodeIndexOf: new Map([[a, 0], [b, 1]]), componentIndexOf: new Map() },
  };
}

describe('SceneDocument — agent edits (MCP edit_scene)', () => {
  it('applies id-addressed edits through the undoable funnel, reporting failures per edit', () => {
    const { graph, node, rotator } = makeGraph();
    graph.compiled.nodes[0]!.id = 'obj'; // agent edits address nodes by scene id
    const doc = new SceneDocument(graph);
    const result = doc.applyAgentEdits([
      { node: 'obj', component: 'Rotator', attr: 'speed', value: 5 },
      { node: 'obj', attr: 'position', value: '1 2 3' }, // friendly string form coerces
      { node: 'missing', attr: 'visible', value: false },
    ]);
    expect(result.applied).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain('no node with id "missing"');
    expect((rotator as unknown as { speed: number }).speed).toBe(5);
    expect(node.position.toArray()).toEqual([1, 2, 3]);
    expect(doc.isDirty).toBe(true);
    doc.undoLast(); // agent edits are undoable, exactly like inspector edits
    expect(node.position.toArray()).toEqual([0, 1, 0]);
  });
});

describe('SceneDocument — attachment editing', () => {
  it('copy-on-write changes only the edited node, not a sibling sharing the pooled asset', () => {
    const { graph, provenance, a, b } = makeSharedMaterialGraph();
    const doc = new SceneDocument(graph, provenance);
    doc.setAttachmentProp(a, 0, 'color', 0x00ff00);
    expect(colorOf(a)).toBe(0x00ff00); // edited node updated
    expect(colorOf(b)).toBe(0xffffff); // sibling untouched
    doc.undoLast();
    expect(colorOf(a)).toBe(0xffffff);
    expect(doc.isDirty).toBe(false);
  });

  it('rejects edits to prefab-internal content', () => {
    const { graph, node } = makeGraph();
    const internal: SceneProvenance = { nodes: [{ kind: 'prefab-internal' }], attachments: [] };
    const doc = new SceneDocument(graph, internal);
    doc.setTransform(node, 'position', [9, 9, 9]);
    expect(node.position.toArray()).toEqual([0, 1, 0]); // unchanged
    expect(doc.canUndo).toBe(false);
  });

  it('records a reparent as an undoable moveNode op the XML applier resolves', () => {
    // A small live tree: scene → { a → child, b }.
    const scene = new Object3D();
    const a = new Object3D();
    const b = new Object3D();
    const child = new Object3D();
    a.sceneId = 'a';
    b.sceneId = 'b';
    child.sceneId = 'child';
    scene.add(a, b);
    a.add(child);
    const compiled: CompiledScene = {
      root: 0,
      nodes: [{ tag: 'Object3D', parent: -1, children: [], transform: { position: [0, 0, 0], eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true }, attrs: {}, attachments: [], components: [] }],
      attachments: [],
      components: [],
    };
    const graph: SceneGraph = { compiled, nodeByIndex: [scene], nodeIndexOf: new Map([[scene, 0]]), componentIndexOf: new Map() };
    const doc = new SceneDocument(graph);

    doc.moveNode(child, b); // reparent child from a → b
    expect(child.parent).toBe(b); // live scene updated
    expect(doc.isDirty).toBe(true);
    expect(doc.structuralOps()).toEqual([{ op: 'moveNode', target: { id: 'child' }, parent: { id: 'b' } }]);

    // The op-log drives the comment-preserving XML applier end-to-end.
    const xml = `<Scene>\n  <Group id="a">\n    <Group id="child" />\n  </Group>\n  <Group id="b" />\n</Scene>\n`;
    const { text, applied } = applyStructuralOps(xml, toCompilerStructuralOps(doc.structuralOps()));
    expect(applied).toBe(1);
    expect(text).toMatch(/<Group id="b">\s*\n {4}<Group id="child" \/>\s*\n {2}<\/Group>/);

    doc.undoLast();
    expect(child.parent).toBe(a); // reparent reverted
    expect(doc.structuralOps()).toEqual([]);
  });
});

/** A document backed by a real engine + scene graph — needed for id/delete/paste. */
function realDoc(xml: string): { doc: SceneDocument; engine: Engine } {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`fixture failed to compile: ${JSON.stringify(r.diagnostics)}`);
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  const doc = new SceneDocument(engine.getSceneGraph()!, r.provenance, engine);
  return { doc, engine };
}

describe('SceneDocument — id editing', () => {
  it('renames an id (addressed by the loaded id so it resolves in the file), undoable', () => {
    const { doc, engine } = realDoc('<Scene><Group id="a" position="1 0 0" /></Scene>');
    const node = engine.findObject('a')!;

    doc.setId(node, 'b');
    expect(node.sceneId).toBe('b');
    const idEdit = doc.netEdits().find((e) => e.attr === 'id')!;
    expect(idEdit.value).toBe('b');
    expect((idEdit.target as { id?: string }).id).toBe('a'); // addressed by the id still in the file

    // End-to-end: the surgical patcher finds the old id and rewrites it.
    const { text, changed } = patchSceneXml('<Scene>\n  <Group id="a" position="1 0 0" />\n</Scene>\n', doc.netEdits());
    expect(changed).toBe(1);
    expect(text).toContain('id="b"');
    expect(text).not.toContain('id="a"');

    doc.undoLast();
    expect(node.sceneId).toBe('a');
    expect(doc.netEdits().some((e) => e.attr === 'id')).toBe(false);
  });

  it('rejects an empty id or a duplicate of another live node', () => {
    const { doc, engine } = realDoc('<Scene><Group id="a" /><Group id="b" /></Scene>');
    const a = engine.findObject('a')!;
    doc.setId(a, '   ');
    doc.setId(a, 'b'); // clashes with the sibling
    expect(a.sceneId).toBe('a');
    expect(doc.isDirty).toBe(false);
  });
});

describe('SceneDocument — node attributes', () => {
  it('reads the authored value or the registry default, edits it, saves it, and undoes', () => {
    const { doc, engine } = realDoc('<Scene><PerspectiveCamera id="cam" fov="60" /></Scene>');
    const cam = engine.findObject('cam')!;

    expect(doc.nodeAttr(cam, 'fov')).toBe(60); // authored
    expect(doc.nodeAttr(cam, 'near')).toBe(0.1); // unset → the @property default
    expect(doc.isDirty).toBe(false);

    doc.setNodeAttr(cam, 'fov', 35);
    expect(doc.nodeAttr(cam, 'fov')).toBe(35);
    // A node attr is a construction parameter, so it must reach the save payload —
    // there is no live object write-through that a diff could otherwise pick up.
    expect(doc.isDirty).toBe(true);
    expect(doc.netEdits()).toContainEqual(expect.objectContaining({ attr: 'fov', value: 35 }));

    doc.undoLast();
    expect(doc.nodeAttr(cam, 'fov')).toBe(60);
    expect(doc.isDirty).toBe(false);
  });

  it('leaves the source untouched when a value is re-set to what it already was', () => {
    // The inspector renders an unset optional attribute with a neutral placeholder.
    // Committing that placeholder unchanged must NOT materialise the attribute —
    // otherwise merely focusing a field would write it into the file.
    const src = '<Scene>\n  <PerspectiveCamera id="cam" fov="60" />\n</Scene>\n';
    const { doc, engine } = realDoc(src);
    const cam = engine.findObject('cam')!;

    doc.setNodeAttr(cam, 'fov', 60); // same value the file already has
    expect(doc.isDirty).toBe(false);
    expect(doc.netEdits()).toEqual([]);
    expect(applySaveOps(src, doc.netEdits(), doc.structuralOps()).text).toBe(src);
  });

  it('clears a written attribute, removing it from the XML, and undo restores it', () => {
    const src = '<Scene>\n  <PerspectiveCamera id="cam" fov="60" near="0.5" />\n</Scene>\n';
    const { doc, engine } = realDoc(src);
    const cam = engine.findObject('cam')!;
    expect(doc.isNodeAttrSet(cam, 'fov')).toBe(true);

    doc.clearNodeAttr(cam, 'fov');
    expect(doc.isNodeAttrSet(cam, 'fov')).toBe(false);
    expect(doc.nodeAttr(cam, 'fov')).toBe(50); // falls back to the @property default
    expect(doc.netEdits()).toContainEqual(expect.objectContaining({ attr: 'fov', value: null }));

    const out = applySaveOps(src, doc.netEdits(), doc.structuralOps());
    expect(out.unresolved).toBe(0);
    expect(out.text).not.toContain('fov=');
    expect(out.text).toContain('near="0.5"'); // the sibling attribute survives
    expect(compileSceneXml(out.text).ok).toBe(true);

    doc.undoLast();
    expect(doc.isNodeAttrSet(cam, 'fov')).toBe(true);
    expect(doc.isDirty).toBe(false);
  });

  it('distinguishes written from unset for an attribute with no default', () => {
    // `hasNodeAttr` is what drives the inspector's unset styling and × button.
    const { doc, engine } = realDoc('<Scene><PerspectiveCamera id="cam" fov="60" /></Scene>');
    const cam = engine.findObject('cam')!;
    expect(doc.isNodeAttrSet(cam, 'fov')).toBe(true); // in the file
    expect(doc.isNodeAttrSet(cam, 'near')).toBe(false); // defaulted, not written
    expect(doc.nodeAttr(cam, 'near')).toBe(0.1);
  });

  it('writes through to the XML on save', () => {
    const src = '<Scene>\n  <PerspectiveCamera id="cam" fov="60" />\n</Scene>\n';
    const { doc, engine } = realDoc(src);
    doc.setNodeAttr(engine.findObject('cam')!, 'fov', 35);

    const out = applySaveOps(src, doc.netEdits(), doc.structuralOps());
    expect(out.unresolved).toBe(0);
    expect(out.text).toContain('fov="35"');
    expect(compileSceneXml(out.text).ok).toBe(true);
  });
});

describe('SceneDocument — clearing an attachment attribute', () => {
  const SRC = '<Scene>\n  <Mesh id="m">\n    <Attachments>\n      <SphereGeometry radius="0.3" widthSegments="16" />\n    </Attachments>\n  </Mesh>\n</Scene>\n';

  it('clears an inline attachment attr and removes it from the XML', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;

    expect(doc.isAttachmentAttrSet(mesh, 0, 'radius')).toBe(true);
    doc.clearAttachmentAttr(mesh, 0, 'radius');
    expect(doc.isAttachmentAttrSet(mesh, 0, 'radius')).toBe(false);

    const out = applySaveOps(SRC, doc.netEdits(), doc.structuralOps());
    expect(out.unresolved).toBe(0);
    expect(out.text).not.toContain('radius=');
    expect(out.text).toContain('widthSegments="16"'); // the sibling attribute survives
    expect(compileSceneXml(out.text).ok).toBe(true);

    doc.undoLast();
    expect(doc.isAttachmentAttrSet(mesh, 0, 'radius')).toBe(true);
    expect(doc.isDirty).toBe(false);
  });

  it('copy-on-writes the clear, so a sibling sharing the pooled asset keeps its value', () => {
    const { graph, provenance, a, b } = makeSharedMaterialGraph();
    const doc = new SceneDocument(graph, provenance);
    doc.setAttachmentProp(a, 0, 'color', 0x00ff00); // private copy for `a`
    expect(colorOf(b)).toBe(0xffffff);

    doc.clearAttachmentAttr(a, 0, 'color');
    expect(colorOf(b)).toBe(0xffffff); // sibling still untouched by the clear
    expect(doc.isAttachmentAttrSet(a, 0, 'color')).toBe(false);
  });
});

describe('SceneDocument — clearing a component property', () => {
  const SRC = '<Scene>\n  <Group id="g">\n    <Components>\n      <Rotator id="r" speed="5" />\n    </Components>\n  </Group>\n</Scene>\n';

  it('clears a written property back to its default, removes it from the XML, and undo restores', () => {
    const { doc, engine } = realDoc(SRC);
    const rotator = engine.findObject('g')!.getComponents()[0]!;
    const live = rotator as unknown as { speed: number };

    expect(doc.isComponentPropSet(rotator, 'speed')).toBe(true); // 5 ≠ the default 1
    doc.clearComponentProp(rotator, 'speed');

    expect(live.speed).toBe(1); // live field back to the @property default
    expect(doc.isComponentPropSet(rotator, 'speed')).toBe(false);
    expect(doc.netEdits()).toContainEqual(expect.objectContaining({ attr: 'speed', value: null }));

    const out = applySaveOps(SRC, doc.netEdits(), doc.structuralOps());
    expect(out.unresolved).toBe(0);
    expect(out.text).not.toContain('speed=');
    expect(out.text).toContain('<Rotator id="r" />');
    expect(compileSceneXml(out.text).ok).toBe(true);

    doc.undoLast();
    expect(live.speed).toBe(5);
    expect(doc.isDirty).toBe(false);
  });

  it('treats a property left at its default as unwritten, so it shows no clear action', () => {
    const { doc, engine } = realDoc('<Scene><Group id="g"><Components><Rotator id="r" /></Components></Group></Scene>');
    const rotator = engine.findObject('g')!.getComponents()[0]!;
    expect(doc.isComponentPropSet(rotator, 'speed')).toBe(false);
  });
});

describe('SceneDocument — delete', () => {
  it('detaches + tombstones a node, records a removeNode op the splicer applies, and undo restores', () => {
    const { doc, engine } = realDoc('<Scene><Group id="a" /><Group id="b" /></Scene>');
    const a = engine.findObject('a')!;
    const scene = engine.scene;

    doc.removeNode(a);
    expect(a.parent).toBeNull(); // gone from the live scene
    expect(doc.structuralOps()).toEqual([{ op: 'removeNode', target: { id: 'a' } }]);

    const src = '<Scene>\n  <Group id="a" />\n  <Group id="b" />\n</Scene>\n';
    const { text, applied } = applyStructuralOps(src, toCompilerStructuralOps(doc.structuralOps()));
    expect(applied).toBe(1);
    expect(text).not.toContain('id="a"');
    expect(text).toContain('id="b"');

    doc.undoLast();
    expect(a.parent).toBe(scene); // re-attached
    expect(doc.structuralOps()).toEqual([]);
  });
});

describe('SceneDocument — copy / paste', () => {
  it('copies a subtree, pastes it live + fully editable, and drives the insert splice; undo removes it', () => {
    const { doc, engine } = realDoc('<Scene><Group id="src"><Group id="kid" position="1 0 0" /></Group><Group id="dst" /></Scene>');
    const dst = engine.findObject('dst')!;
    const before = dst.children.length;

    const fragment = doc.copyFragment(engine.findObject('src')!)!;
    expect(fragment.nodes).toHaveLength(2); // src + kid
    expect(fragment.nodes.every((n) => n.id === undefined)).toBe(true); // ids stripped

    const pasted = doc.pasteFragment(fragment, dst)!;
    expect(dst.children).toContain(pasted); // spawned live under dst
    expect(dst.children.length).toBe(before + 1);

    // Fully editable: an edit to the pasted node lands in the compiled model and is
    // reflected in the re-derived insert fragment (so it's saved, not lost).
    doc.setTransform(pasted, 'position', [5, 5, 5]);
    expect(pasted.position.toArray()).toEqual([5, 5, 5]);
    const ops = doc.structuralOps();
    expect(ops).toHaveLength(1);
    const insert = ops[0] as { op: 'insertNode'; fragment: CompiledScene };
    expect(insert.op).toBe('insertNode');
    expect(insert.fragment.nodes[insert.fragment.root]!.transform.position).toEqual([5, 5, 5]);

    // The server path, through the real bridge — `insertNode` is the one op whose
    // editor and compiler shapes differ (compiled fragment vs. XML), so going via
    // `toCompilerStructuralOps` is what actually covers the conversion. Hand-rolling
    // `xml: serializeScene(...)` here would re-implement the thing under test.
    const src = '<Scene>\n  <Group id="src">\n    <Group id="kid" position="1 0 0" />\n  </Group>\n  <Group id="dst" />\n</Scene>\n';
    const inserted = applyStructuralOps(src, toCompilerStructuralOps(ops));
    expect(inserted.applied).toBe(1);
    expect(compileSceneXml(inserted.text).ok).toBe(true);
    // …and the spliced text is the *pasted subtree*, carrying the edit made above.
    // `applied === 1` plus "it still compiles" would accept any well-formed element,
    // so assert the actual content: the copied child, under a node at the new position.
    const dstBlock = /<Group id="dst">([\s\S]*?)<\/Group>/.exec(inserted.text)?.[1] ?? '';
    expect(dstBlock).toMatch(/position="5 5 5"/);
    expect(dstBlock).toMatch(/<Group position="1 0 0"\s*\/>/); // the copied kid, ids stripped

    doc.undoLast(); // undo the transform edit
    doc.undoLast(); // undo the paste
    expect(dst.children.length).toBe(before);
    expect(doc.structuralOps()).toEqual([]);
  });
});
