import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { Component, CompiledScene, SceneGraph } from '@scenoco-three/core';
import { SceneDocument } from '../packages/editor/app/document.js';
import { Rotator } from './fixtures/components/Rotator.js';

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
