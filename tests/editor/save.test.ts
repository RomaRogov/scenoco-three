import { describe, expect, it } from 'vitest';
import { compileSceneXml, type PatchEdit } from '@scenoco-three/compiler';
import { applySaveOps } from '../../packages/editor/src/structuralOps.js';
import type { StructuralOp } from '../../packages/editor/src/protocol.js';

/** Two sibling groups with a comment, so byte-preservation is observable. */
const SCENE = `<Scene>
  <!-- keep me -->
  <Group id="a">
    <Group id="kid" position="1 0 0" />
  </Group>
  <Group id="b" />
</Scene>
`;

const edit = (id: string, attr: string, value: PatchEdit['value']): PatchEdit => ({
  target: { kind: 'node', id },
  attr,
  value,
});

describe('editor save — applySaveOps', () => {
  it('reshapes the tree before patching attributes, so an edit lands on the moved element', () => {
    // #kid moves under #b *and* gets a new position in one save. If the patch ran
    // first it would still resolve (ids are stable) — the ordering shows up in the
    // output: the moved element must carry the patched attribute.
    const ops: StructuralOp[] = [{ op: 'moveNode', target: { id: 'kid' }, parent: { id: 'b' } }];
    const out = applySaveOps(SCENE, [edit('kid', 'position', [9, 9, 9])], ops);

    expect(out.unresolved).toBe(0);
    expect(out.changed).toBe(2); // 1 structural + 1 attribute
    const bBlock = /<Group id="b">([\s\S]*?)<\/Group>/.exec(out.text)?.[1] ?? '';
    expect(bBlock).toMatch(/id="kid"/);
    expect(bBlock).toMatch(/position="9 9 9"/);
    expect(compileSceneXml(out.text).ok).toBe(true);
  });

  it('preserves untouched bytes — comments and formatting survive a save', () => {
    const out = applySaveOps(SCENE, [edit('kid', 'position', [2, 0, 0])]);
    expect(out.text).toContain('<!-- keep me -->');
    expect(out.text).toContain('<Group id="b" />');
  });

  it('counts unresolved edits from both phases instead of failing the save', () => {
    // A structural op and an attribute edit that both address a node that isn't
    // there. Neither throws: the save reports what it could not place, so the
    // caller warns and still writes the edits that did land.
    const ops: StructuralOp[] = [{ op: 'removeNode', target: { id: 'ghost' } }];
    const out = applySaveOps(SCENE, [edit('phantom', 'position', [1, 1, 1]), edit('kid', 'position', [3, 0, 0])], ops);

    expect(out.unresolved).toBe(2); // one structural + one attribute
    expect(out.changed).toBe(1); // the real edit still applied
    expect(out.text).toContain('position="3 0 0"');
  });

  it('is a no-op when there is nothing to apply', () => {
    const out = applySaveOps(SCENE, []);
    expect(out).toMatchObject({ text: SCENE, changed: 0, unresolved: 0 });
  });
});
