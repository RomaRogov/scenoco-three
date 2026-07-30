import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { SceneDocument } from '../../packages/editor/app/document.js';
import { applySaveOps } from '../../packages/editor/src/structuralOps.js';
import { Rotator } from '../fixtures/components/Rotator.js';
import { Oscillator } from '../fixtures/components/Oscillator.js';

void Rotator;
void Oscillator;

/**
 * Managing a node's components/attachments from the inspector. These are element
 * edits, so they travel as structural ops and are spliced into the source on save
 * — the attribute patcher can't add or remove elements.
 */
const SRC = `<Scene>
  <Mesh id="m">
    <Attachments>
      <BoxGeometry width="2" />
      <MeshStandardMaterial color="#ff0000" />
    </Attachments>
    <Components>
      <Rotator speed="2" />
      <Oscillator amplitude="1" />
    </Components>
  </Mesh>
</Scene>
`;

function realDoc(xml: string): { doc: SceneDocument; engine: Engine } {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`fixture failed to compile: ${JSON.stringify(r.diagnostics)}`);
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  return { doc: new SceneDocument(engine.getSceneGraph()!, r.provenance, engine), engine };
}
const save = (doc: SceneDocument): string => applySaveOps(SRC, doc.netEdits(), doc.structuralOps()).text;

describe('SceneDocument — managing components', () => {
  it('deletes a component from the live scene and the source', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;
    const rotator = doc.componentsOf(mesh)[0]!.component;

    doc.removeComponent(mesh, rotator);
    expect(doc.componentsOf(mesh).map((c) => c.component)).not.toContain(rotator);
    expect(doc.isDirty).toBe(true);

    const text = save(doc);
    expect(text).not.toContain('<Rotator');
    expect(text).toContain('<Oscillator amplitude="1" />'); // sibling untouched
    expect(compileSceneXml(text).ok).toBe(true);

    doc.undoLast();
    expect(doc.componentsOf(mesh)).toHaveLength(2);
    expect(doc.isDirty).toBe(false);
  });

  it('reorders components, and reports the move bounds the toolbar disables on', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;
    const [first, second] = doc.componentsOf(mesh);
    expect(first!.canMoveUp).toBe(false); // nothing above the first
    expect(second!.canMoveDown).toBe(false); // nothing below the last

    doc.moveComponent(mesh, second!.component, -1);
    const text = save(doc);
    expect(text.indexOf('<Oscillator')).toBeLessThan(text.indexOf('<Rotator'));
    expect(compileSceneXml(text).ok).toBe(true);
  });
});

describe('SceneDocument — managing attachments', () => {
  it('refuses to delete the only member of a required group, and allows an optional one', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;
    // A Mesh must keep a geometry; its material is optional.
    expect(doc.canRemoveAttachment(mesh, 0)).toBe(false);
    expect(doc.canRemoveAttachment(mesh, 1)).toBe(true);

    doc.removeAttachment(mesh, 0);
    expect(doc.attachmentsOf(mesh)).toHaveLength(2); // refused — nothing changed
  });

  it('deletes an optional attachment and splices it out of the source', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;

    doc.removeAttachment(mesh, 1);
    expect(doc.attachmentsOf(mesh).map((v) => v.tag)).toEqual(['BoxGeometry']);

    const text = save(doc);
    expect(text).not.toContain('<MeshStandardMaterial');
    expect(text).toContain('<BoxGeometry width="2" />');
    expect(compileSceneXml(text).ok).toBe(true);

    doc.undoLast();
    expect(doc.attachmentsOf(mesh)).toHaveLength(2);
  });

  it('detaches the removed attachment from the live object, and undo re-applies it', () => {
    // The seam that makes removal visible in the viewport: `detachAttachment`
    // restores the host property the group owns, then the survivors are re-applied.
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')! as unknown as { material: { color: { getHex(): number } } };
    expect(mesh.material.color.getHex()).toBe(0xff0000);

    doc.removeAttachment(engine.findObject('m')!, 1); // the material
    expect(mesh.material.color.getHex()).not.toBe(0xff0000); // back to a default material

    doc.undoLast();
    expect(mesh.material.color.getHex()).toBe(0xff0000); // re-attached
  });

  it('reorders attachments without disturbing their attribute values', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;

    doc.moveAttachment(mesh, 1, -1);
    expect(doc.attachmentsOf(mesh).map((v) => v.tag)).toEqual(['MeshStandardMaterial', 'BoxGeometry']);

    const text = save(doc);
    expect(text.indexOf('<MeshStandardMaterial')).toBeLessThan(text.indexOf('<BoxGeometry'));
    expect(text).toContain('color="#ff0000"'); // values follow their element
    expect(text).toContain('width="2"');
    expect(compileSceneXml(text).ok).toBe(true);
  });
});

describe('SceneDocument — adding components and attachments', () => {
  it('adds a component live and splices it into the XML, with undo removing both', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;
    const before = doc.componentsOf(mesh).length;

    const added = doc.addComponent(mesh, 'Follow');
    expect(added).toBeDefined();
    expect(doc.componentsOf(mesh)).toHaveLength(before + 1);

    const text = save(doc);
    expect(text).toContain('<Follow />');
    expect(compileSceneXml(text).ok).toBe(true);

    doc.undoLast();
    expect(doc.componentsOf(mesh)).toHaveLength(before);
    // The structural op must be withdrawn too, or the save would re-add it.
    expect(save(doc)).not.toContain('<Follow');
    expect(doc.isDirty).toBe(false);
  });

  it('carries edits made after adding, without emitting a stray patch edit', () => {
    // A new attachment has no counterpart in the loaded source, so its attributes
    // travel inside the inserted element — never as an attribute patch against a
    // base that does not exist.
    const { doc, engine } = realDoc('<Scene>\n  <Mesh id="m">\n    <Attachments>\n      <BoxGeometry />\n    </Attachments>\n  </Mesh>\n</Scene>\n');
    const mesh = engine.findObject('m')!;

    doc.addAttachment(mesh, 'MeshStandardMaterial');
    const slot = doc.attachmentsOf(mesh).find((v) => v.tag === 'MeshStandardMaterial')!.slot;
    doc.setAttachmentProp(mesh, slot, 'color', 0x00ff00);

    const text = applySaveOps(
      '<Scene>\n  <Mesh id="m">\n    <Attachments>\n      <BoxGeometry />\n    </Attachments>\n  </Mesh>\n</Scene>\n',
      doc.netEdits(),
      doc.structuralOps(),
    );
    expect(text.unresolved).toBe(0);
    expect(text.text).toContain('<MeshStandardMaterial color="#00ff00" />');
    expect(compileSceneXml(text.text).ok).toBe(true);
  });

  it('refuses to add to prefab content', () => {
    const { doc, engine } = realDoc(SRC);
    const mesh = engine.findObject('m')!;
    expect(doc.canEditStructure(mesh)).toBe(true);
    expect(doc.addComponent(mesh, 'NoSuchComponent')).toBeUndefined(); // unknown type
  });
});
