import { describe, expect, it } from 'vitest';
import { applyStructuralOps, compileSceneXml, type StructuralOp } from '@scenoco-three/compiler';

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
});
