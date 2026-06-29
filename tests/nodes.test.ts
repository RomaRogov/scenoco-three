import { afterAll, describe, expect, it } from 'vitest';
import { Group, Mesh, TorusKnotGeometry } from 'three';
import {
  Attachment,
  Object3DNode,
  allNodeDefs,
  attachment,
  getAttachmentDef,
  getNodeDef,
  instantiateScene,
  node,
  property,
  unregisterAttachment,
  unregisterNode,
  type AttachContext,
} from '@scenoco-three/core';
import { compileSceneXml } from '@scenoco-three/compiler';

/**
 * The tag system is an extensible registry that uses the *same* authoring idiom
 * as components: a class + a class decorator + `@property` fields. Nodes use
 * `@node`, leaf config uses `@attachment(target)`. Built-ins live one-per-file
 * under core/src/nodes/**; projects register their own the same way.
 */
describe('tag registry — built-ins', () => {
  it('registers built-in node and attachment tags', () => {
    expect(getNodeDef('Mesh')?.kind).toBe('object3d');
    expect(getAttachmentDef('BoxGeometry')?.group).toBe('geometry');
    expect(getAttachmentDef('MeshStandardMaterial')?.group).toBe('material');
    expect(allNodeDefs().length).toBeGreaterThan(10);
  });
});

describe('custom node + custom attachment (goal: flexibility)', () => {
  // A project-defined node and an attachment that targets *only* it — impossible
  // with the old fixed geometry/material/setting kinds.
  @node({ name: 'Widget', description: 'A test-only node' })
  class WidgetNode extends Object3DNode {
    build(): Group {
      return new Group();
    }
  }
  @attachment({ name: 'Knot', description: 'torus-knot shape', target: 'Widget', group: 'shape', required: true })
  class KnotAttachment extends Attachment {
    @property({ type: 'float', default: 1, description: 'knot radius' }) radius = 1;
    attach(ctx: AttachContext): void {
      ctx.node.add(new Mesh(new TorusKnotGeometry(this.radius)));
    }
  }
  void WidgetNode;
  void KnotAttachment;

  afterAll(() => {
    unregisterNode('Widget');
    unregisterAttachment('Knot');
  });

  it('a custom attachment validates only on its target node', () => {
    const ok = compileSceneXml(`<Scene><Widget id="w"><Knot radius="2" /></Widget></Scene>`);
    expect(ok.ok).toBe(true);

    // The same attachment on a Mesh (not its target) is rejected.
    const bad = compileSceneXml(`<Scene><Mesh id="m"><BoxGeometry /><Knot /></Mesh></Scene>`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.diagnostics.some((d) => d.code === 'attachment-wrong-target')).toBe(true);
  });

  it('a required attachment group is enforced (Widget needs a Knot)', () => {
    const r = compileSceneXml(`<Scene><Widget id="w" /></Scene>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.code).toBe('missing-required-attachment');
  });

  it('a custom node instantiates and its attachment runs', () => {
    const r = compileSceneXml(`<Scene><Widget id="w"><Knot radius="2" /></Widget></Scene>`);
    if (!r.ok) throw new Error('compile failed');
    const live = instantiateScene(r.scene);
    const widget = live.root.getObjectByName('w')!;
    expect(widget).toBeInstanceOf(Group);
    expect(widget.children.length).toBe(1); // the knot mesh
  });
});
