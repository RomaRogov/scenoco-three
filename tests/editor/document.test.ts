import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { getAttachmentDef, type Component, type CompiledScene, type SceneGraph } from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import { applyStructuralOps } from '@scenoco-three/compiler';
import { SceneDocument } from '../../packages/editor/app/document.js';
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
    const { text, applied } = applyStructuralOps(xml, doc.structuralOps());
    expect(applied).toBe(1);
    expect(text).toMatch(/<Group id="b">\s*\n {4}<Group id="child" \/>\s*\n {2}<\/Group>/);

    doc.undoLast();
    expect(child.parent).toBe(a); // reparent reverted
    expect(doc.structuralOps()).toEqual([]);
  });
});
