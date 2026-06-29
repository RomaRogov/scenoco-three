import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { getAttachmentDef, type Component, type CompiledScene, type SceneGraph } from '@scenoco-three/core';
import type { SceneProvenance } from '@scenoco-three/compiler';
import { SceneDocument } from '../packages/editor/app/document.js';
import { Rotator } from './fixtures/components/Rotator.js';

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
    nodes: [
      {
        tag: 'Object3D',
        parent: -1,
        children: [],
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
        attrs: {},
        attachments: [],
        components: [0],
      },
    ],
    attachments: [],
    components: [{ type: 'Rotator', node: 0, props: {} }],
  };
  return {
    node,
    rotator,
    graph: {
      compiled,
      nodeByIndex: [node],
      nodeIndexOf: new Map([[node, 0]]),
      componentIndexOf: new Map([[rotator, 0]]),
    },
  };
}

describe('SceneDocument — stateful edits', () => {
  it('applies a transform to the live object and tracks it as a net edit', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    expect(doc.isDirty).toBe(false);

    doc.setTransform(node, 'position', [5, 1, 0]);
    expect(node.position.toArray()).toEqual([5, 1, 0]);
    expect(doc.isDirty).toBe(true);
    expect(doc.netEdits()).toEqual([{ target: { kind: 'node', nodeIndex: 0 }, attr: 'position', value: [5, 1, 0] }]);
  });

  it('undo/redo restores live + compiled state and clears/restores net edits', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setTransform(node, 'position', [5, 1, 0]);

    doc.undoLast();
    expect(node.position.toArray()).toEqual([0, 1, 0]);
    expect(doc.isDirty).toBe(false);
    expect(doc.netEdits()).toEqual([]);

    doc.redoLast();
    expect(node.position.toArray()).toEqual([5, 1, 0]);
    expect(doc.netEdits()).toHaveLength(1);
  });

  it('coalesces a scrub/drag (same node + channel) into one undo step', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setTransform(node, 'position', [1, 1, 0], { coalesce: true });
    doc.setTransform(node, 'position', [2, 1, 0], { coalesce: true });
    doc.setTransform(node, 'position', [3, 1, 0], { coalesce: true });

    expect(doc.netEdits()).toEqual([{ target: { kind: 'node', nodeIndex: 0 }, attr: 'position', value: [3, 1, 0] }]);
    doc.undoLast(); // one undo rewinds the whole gesture
    expect(node.position.toArray()).toEqual([0, 1, 0]);
    expect(doc.canUndo).toBe(false);
  });

  it('skips no-op transforms (unchanged channels after a gizmo drag)', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setTransform(node, 'scale', [1, 1, 1]); // already the default/current
    expect(doc.canUndo).toBe(false);
    expect(doc.netEdits()).toEqual([]);
  });

  it('edits a component property and emits a component-addressed net edit', () => {
    const { graph, rotator } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setComponentProp(rotator, 'speed', 5);
    expect((rotator as unknown as { speed: number }).speed).toBe(5);
    expect(doc.netEdits()).toEqual([
      { target: { kind: 'component', componentIndex: 0, nodeIndex: 0, type: 'Rotator', ordinal: 0 }, attr: 'speed', value: 5 },
    ]);

    doc.undoLast();
    expect((rotator as unknown as { speed: number }).speed).toBe(1);
    expect(doc.netEdits()).toEqual([]);
  });

  it('marks saved without losing undo history', () => {
    const { graph, node } = makeGraph();
    const doc = new SceneDocument(graph);
    doc.setTransform(node, 'position', [5, 1, 0]);
    doc.markSaved();
    expect(doc.isDirty).toBe(false);
    expect(doc.canUndo).toBe(true); // history intact
  });
});

/** Two meshes sharing one pooled MeshStandardMaterial (white) + scene provenance. */
function makeSharedMaterialGraph(): { graph: SceneGraph; provenance: SceneProvenance; a: Object3D; b: Object3D } {
  const a = new Mesh();
  const b = new Mesh();
  // Live: one material instance attached to both (the pooled/shared case).
  const inst = getAttachmentDef('MeshStandardMaterial')!.make({ color: 0xffffff });
  inst.attach({ node: a });
  inst.attach({ node: b });
  const meshNode = (): CompiledScene['nodes'][number] => ({
    tag: 'Mesh',
    parent: -1,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
    attrs: {},
    attachments: [0], // both reference the same pooled asset
    components: [],
  });
  const compiled: CompiledScene = {
    root: 0,
    nodes: [{ ...meshNode(), id: 'a' }, { ...meshNode(), id: 'b' }],
    attachments: [{ tag: 'MeshStandardMaterial', attrs: { color: 0xffffff } }],
    components: [],
  };
  return {
    a,
    b,
    provenance: { nodes: [{ kind: 'scene' }, { kind: 'scene' }], attachments: [null] },
    graph: { compiled, nodeByIndex: [a, b], nodeIndexOf: new Map([[a, 0], [b, 1]]), componentIndexOf: new Map() },
  };
}

/** Like makeGraph but the node carries an id, so it's addressable by `applyEdits`. */
function makeIdGraph(): { graph: SceneGraph; node: Object3D; rotator: Component } {
  const node = new Object3D();
  node.position.set(0, 1, 0);
  const rotator = new Rotator();
  rotator.node = node;
  const compiled: CompiledScene = {
    root: 0,
    nodes: [
      {
        tag: 'Object3D',
        id: 'spin',
        parent: -1,
        children: [],
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
        attrs: {},
        attachments: [],
        components: [0],
      },
    ],
    attachments: [],
    components: [{ type: 'Rotator', node: 0, props: {} }],
  };
  return {
    node,
    rotator,
    graph: { compiled, nodeByIndex: [node], nodeIndexOf: new Map([[node, 0]]), componentIndexOf: new Map([[rotator, 0]]) },
  };
}

describe('SceneDocument — applyEdits (preserve unsaved edits across a reload)', () => {
  it('re-applies transform + component edits by id onto a fresh document', () => {
    const a = makeIdGraph();
    const docA = new SceneDocument(a.graph);
    docA.setTransform(a.node, 'position', [5, 1, 0]);
    docA.setComponentProp(a.rotator, 'speed', 9);
    const edits = docA.netEdits();

    // A fresh document (as if reloaded after a dep change) re-applies them by id.
    const b = makeIdGraph();
    const docB = new SceneDocument(b.graph);
    docB.applyEdits(edits);

    expect(b.node.position.toArray()).toEqual([5, 1, 0]);
    expect((b.rotator as unknown as { speed: number }).speed).toBe(9);
    expect(docB.netEdits()).toEqual(expect.arrayContaining(edits));
  });
});

describe('SceneDocument — attachment editing', () => {
  it('copy-on-write changes only the edited node, not a sibling sharing the asset', () => {
    const { graph, provenance, a, b } = makeSharedMaterialGraph();
    expect(colorOf(a)).toBe(0xffffff);
    expect(colorOf(b)).toBe(0xffffff);

    const doc = new SceneDocument(graph, provenance);
    doc.setAttachmentProp(a, 0, 'color', 0x00ff00);

    expect(colorOf(a)).toBe(0x00ff00); // edited node updated
    expect(colorOf(b)).toBe(0xffffff); // sibling untouched
    expect(doc.netEdits()).toContainEqual(
      expect.objectContaining({ attr: 'color', value: 0x00ff00, target: expect.objectContaining({ kind: 'attachment', nodeId: 'a', tag: 'MeshStandardMaterial' }) }),
    );

    doc.undoLast();
    expect(colorOf(a)).toBe(0xffffff);
    expect(doc.isDirty).toBe(false);
  });

  it('rejects edits to prefab-internal content', () => {
    const { graph } = makeGraph();
    const internal: SceneProvenance = { nodes: [{ kind: 'prefab-internal' }], attachments: [] };
    const node = graph.nodeByIndex[0]!;
    const doc = new SceneDocument(graph, internal);
    doc.setTransform(node, 'position', [9, 9, 9]);
    expect(node.position.toArray()).toEqual([0, 1, 0]); // unchanged
    expect(doc.canUndo).toBe(false);
  });
});
