import { describe, expect, it } from 'vitest';
import { applyStructuralOps, compileSceneXml, serializeScene, type StructuralOp } from '@scenoco-three/compiler';
import type { CompiledScene } from '@scenoco-three/core';

// A valid, compilable scene with comments at several nesting levels — to prove
// comment/formatting survival across structural edits. Groups need no attachments,
// so nodes stay movable without geometry noise.
const SCENE = `<Scene>
  <!-- lighting -->
  <PointLight id="lamp" intensity="20" />
  <Group id="rig">
    <Group id="box" position="1 0 0" />
  </Group>
  <!-- the hero -->
  <Group id="hero" position="0 0 0" />
</Scene>
`;

const apply = (xml: string, ...ops: StructuralOp[]) => applyStructuralOps(xml, ops);
const recompiles = (xml: string): boolean => compileSceneXml(xml).ok;

describe('applyStructuralOps — comment-preserving structural XML edits', () => {
  it('starts from a compilable fixture and is the identity for an empty op-log', () => {
    expect(recompiles(SCENE)).toBe(true);
    expect(apply(SCENE).text).toBe(SCENE);
  });

  it('removes a node together with its own leading comment, leaving others intact', () => {
    const { text, applied, unresolved } = apply(SCENE, { op: 'removeNode', target: { id: 'lamp' } });
    expect({ applied, unresolved }).toEqual({ applied: 1, unresolved: [] });
    expect(text).not.toContain('lamp');
    expect(text).not.toContain('<!-- lighting -->'); // the node's banner went with it
    expect(text).toContain('<!-- the hero -->'); // an unrelated comment is untouched
    expect(text).toContain('id="box"');
    expect(recompiles(text)).toBe(true);
  });

  it('reparents a node — carrying its comment and re-indenting to the new depth', () => {
    const { text, applied } = apply(SCENE, { op: 'moveNode', target: { id: 'hero' }, parent: { id: 'rig' } });
    expect(applied).toBe(1);
    // hero now sits inside <Group id="rig"> at the rig-child indent (4 spaces), and
    // its comment travelled with it.
    expect(text).toMatch(/<Group id="rig">[\s\S]*\n {4}<!-- the hero -->\n {4}<Group id="hero"[\s\S]*<\/Group>/);
    // and it is gone from the top level (no </Group> immediately followed by that comment)
    expect(text).not.toMatch(/<\/Group>\s*\n\s*<!-- the hero -->/);
    expect(recompiles(text)).toBe(true);
  });

  it('inserts a new node under a parent at the parent-child indent', () => {
    const { text, applied } = apply(SCENE, { op: 'insertNode', parent: { id: 'rig' }, xml: '<Group id="added" position="2 2 2" />' });
    expect(applied).toBe(1);
    expect(text).toMatch(/<Group id="rig">[\s\S]*\n {4}<Group id="added" position="2 2 2" \/>\s*\n {2}<\/Group>/);
    expect(recompiles(text)).toBe(true);
  });

  it('honours an insertion index (before the Nth node child)', () => {
    const { text } = apply(SCENE, { op: 'insertNode', parent: { path: [] }, index: 0, xml: '<Group id="first" />' });
    // inserted before the first node child of the scene root (which owns the lighting comment)
    expect(text).toMatch(/<Scene>\s*\n {2}<Group id="first" \/>\s*\n {2}<!-- lighting -->/);
    expect(recompiles(text)).toBe(true);
  });

  it('leaves an unresolvable op in `unresolved` and the text unchanged', () => {
    const { text, applied, unresolved } = apply(SCENE, { op: 'removeNode', target: { id: 'ghost' } });
    expect(applied).toBe(0);
    expect(unresolved).toHaveLength(1);
    expect(text).toBe(SCENE);
  });

  it('refuses to move a node into itself or a descendant', () => {
    const { applied, unresolved } = apply(SCENE, { op: 'moveNode', target: { id: 'rig' }, parent: { id: 'box' } });
    expect(applied).toBe(0);
    expect(unresolved).toHaveLength(1);
  });

  it('applies an ordered op-log (remove then insert) in sequence', () => {
    const { text, applied } = apply(
      SCENE,
      { op: 'removeNode', target: { id: 'hero' } },
      { op: 'insertNode', parent: { id: 'rig' }, xml: '<Group id="hero2" />' },
    );
    expect(applied).toBe(2);
    expect(text).not.toContain('id="hero"');
    expect(text).toContain('id="hero2"');
    expect(recompiles(text)).toBe(true);
  });

  // The editor's paste path: the browser keeps a compiled fragment (ids stripped to
  // avoid collisions) and the server serializes it to subtree XML at save time, which
  // the same splicer inserts comment-preservingly.
  it('inserts a serialized compiled fragment (the paste path), ids-stripped, comments intact', () => {
    const t = (position: number[]) => ({ position, eulerAngles: [0, 0, 0], scale: [1, 1, 1], visible: true });
    const fragment: CompiledScene = {
      root: 0,
      nodes: [
        { tag: 'Group', parent: -1, children: [1], transform: t([0, 0, 0]), attrs: {}, attachments: [], components: [] },
        { tag: 'Group', parent: 0, children: [], transform: t([1, 0, 0]), attrs: {}, attachments: [], components: [] },
      ],
      attachments: [],
      components: [],
    };
    const xml = serializeScene(fragment);
    expect(xml).not.toContain('id='); // the copy stripped ids

    const { text, applied, unresolved } = apply(SCENE, { op: 'insertNode', parent: { id: 'rig' }, xml });
    expect({ applied, unresolved }).toEqual({ applied: 1, unresolved: [] });
    // The pasted subtree lands under <Group id="rig"> and re-indents to its depth.
    expect(text).toMatch(/<Group id="rig">[\s\S]*\n {4}<Group>\s*\n {6}<Group position="1 0 0" \/>\s*\n {4}<\/Group>/);
    expect(text).toContain('<!-- the hero -->'); // unrelated comments untouched
    expect(recompiles(text)).toBe(true);
  });
});

// ── components / attachments (members of a node's blocks) ───────────────────────

const MEMBERS = `<Scene>
  <Mesh id="m">
    <Attachments>
      <!-- the shape -->
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

describe('applyStructuralOps — components and attachments', () => {
  const ref = (block: 'Components' | 'Attachments', tag: string, ordinal = 0) =>
    ({ node: { id: 'm' }, block, tag, ordinal }) as const;

  it('removes a component, keeping its siblings and the rest of the file byte-exact', () => {
    const { text, applied } = apply(MEMBERS, { op: 'removeMember', target: ref('Components', 'Rotator') });
    expect(applied).toBe(1);
    expect(text).not.toContain('<Rotator');
    expect(text).toContain('<Oscillator amplitude="1" />');
    expect(text).toContain('<!-- the shape -->'); // untouched comment survives
    expect(recompiles(text)).toBe(true);
  });

  it('removes an attachment together with its own leading comment', () => {
    const { text } = apply(MEMBERS, { op: 'removeMember', target: ref('Attachments', 'BoxGeometry') });
    expect(text).not.toContain('<BoxGeometry');
    expect(text).not.toContain('<!-- the shape -->'); // the banner belonged to it
    expect(text).toContain('<MeshStandardMaterial color="#ff0000" />');
  });

  it('reorders a component within its block', () => {
    const { text, applied } = apply(MEMBERS, { op: 'moveMember', target: ref('Components', 'Oscillator'), index: 0 });
    expect(applied).toBe(1);
    expect(text.indexOf('<Oscillator')).toBeLessThan(text.indexOf('<Rotator'));
    expect(recompiles(text)).toBe(true);
  });

  it('leaves an unresolvable member unapplied instead of touching the wrong element', () => {
    const { applied, unresolved } = apply(MEMBERS, { op: 'removeMember', target: ref('Components', 'Rotator', 3) });
    expect(applied).toBe(0);
    expect(unresolved).toHaveLength(1);
  });
});

describe('applyStructuralOps — adding a component or attachment', () => {
  const add = (xml: string, block: 'Components' | 'Attachments', member: string, index?: number) =>
    apply(xml, { op: 'insertMember', node: { id: 'm' }, block, xml: member, ...(index !== undefined ? { index } : {}) });

  it('appends into an existing block, keeping siblings and comments', () => {
    const { text, applied } = add(MEMBERS, 'Components', '<Follow />');
    expect(applied).toBe(1);
    expect(text).toContain('<Follow />');
    expect(text.indexOf('<Oscillator')).toBeLessThan(text.indexOf('<Follow'));
    expect(text).toContain('<!-- the shape -->');
    expect(recompiles(text)).toBe(true);
  });

  it('honours an explicit index', () => {
    const { text } = add(MEMBERS, 'Components', '<Follow />', 0);
    expect(text.indexOf('<Follow')).toBeLessThan(text.indexOf('<Rotator'));
    expect(recompiles(text)).toBe(true);
  });

  it('creates the block when the node has none, in the serializer\'s order', () => {
    // <Attachments> must land before <Components>, matching serializeScene.
    const src = '<Scene>\n  <Group id="m">\n    <Components>\n      <Rotator />\n    </Components>\n  </Group>\n</Scene>\n';
    const { text, applied } = apply(src, {
      op: 'insertMember', node: { id: 'm' }, block: 'Attachments', xml: '<BoxGeometry />',
    });
    expect(applied).toBe(1);
    expect(text.indexOf('<Attachments>')).toBeLessThan(text.indexOf('<Components>'));
    expect(text).toContain('<BoxGeometry />');
  });

  it('expands a self-closing node into one that can hold the new block', () => {
    const src = '<Scene>\n  <Group id="m" />\n</Scene>\n';
    const { text, applied } = apply(src, {
      op: 'insertMember', node: { id: 'm' }, block: 'Components', xml: '<Rotator speed="3" />',
    });
    expect(applied).toBe(1);
    expect(text).toContain('<Group id="m">');
    expect(text).toContain('</Group>');
    expect(text).toContain('<Rotator speed="3" />');
    expect(recompiles(text)).toBe(true);
  });

  it('leaves an unresolvable host unapplied', () => {
    const { applied, unresolved } = apply(MEMBERS, {
      op: 'insertMember', node: { id: 'nope' }, block: 'Components', xml: '<Follow />',
    });
    expect(applied).toBe(0);
    expect(unresolved).toHaveLength(1);
  });
});
