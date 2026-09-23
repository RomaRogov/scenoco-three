import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * Mistakes that used to reach the generated code.
 *
 * Each of these compiled, and then failed from inside a `.gen.ts` — a gitignored artifact that is
 * rewritten on every build, so reading one teaches the wrong file and editing one loses the edit.
 * The four with a rule of their own are answered here by name; the fifth is the backstop that
 * catches whatever has no rule yet, with `tsc`'s own words at the element that caused it.
 */
let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('generated-code');
  fixture.write(
    'game.ts',
    `import { Component } from '@scenoco-three/core';
import type { Mesh, Object3D } from 'three';

/** Declared, but a document cannot import it. */
class Hidden extends Component {
  amount = 1;
}
void Hidden;

export class Slot extends Component {
  mesh!: Mesh;
  anything!: Object3D;
}

export class Tally extends Component {
  score = 0;
}
`,
  );
});
afterAll(() => fixture.dispose());

function check(scene: string): Array<{ code: string; line: number; message: string }> {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  return build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true, typecheck: true }).diagnostics.map(
    ({ code, line, message }) => ({ code, line, message }),
  );
}

describe('a mistake that only generated code could see', () => {
  it('names the file to add `export` to, rather than failing on an import nobody wrote', () => {
    const [said] = check(`<Scene>
  <Group><Components><Hidden amount="2" /></Components></Group>
</Scene>`);
    expect(said?.code).toBe('not-exported');
    expect(said?.line).toBe(2);
    expect(said?.message).toContain('src/game.ts:5');
    expect(said?.message).toContain('Write `export class Hidden …`.');
  }, 60_000);

  it('says which class the node is and which the slot wants', () => {
    const [said] = check(`<Scene>
  <PerspectiveCamera id="eye" />
  <Group><Components><Slot mesh="#eye" /></Components></Group>
</Scene>`);
    expect(said?.code).toBe('wrong-slot');
    expect(said?.message).toContain('points at <PerspectiveCamera id="eye">, and the slot is typed Mesh');
  }, 60_000);

  it('takes an Object3D slot from any node, because every node is one', () => {
    expect(
      check(`<Scene>
  <PerspectiveCamera id="eye" />
  <Group><Components><Slot mesh="#eye" anything="#eye" /></Components></Group>
</Scene>`).filter((d) => d.code !== 'wrong-slot'),
    ).toEqual([]);
  }, 60_000);

  it('refuses an id the class it becomes a field of already declares', () => {
    const [said] = check(`<Scene><Group id="name" /></Scene>`);
    expect(said?.code).toBe('reserved-id');
    expect(said?.message).toContain('already a property of Scene');
    expect(said?.message).toContain('id="nameNode"');
  }, 60_000);

  it('refuses one id on two things, whether they are nodes or components', () => {
    const said = check(`<Scene>
  <Group id="tally" />
  <Group><Components><Tally id="tally" /></Components></Group>
</Scene>`);
    expect(said.map((d) => d.code)).toEqual(['duplicate-id']);
    expect(said[0]!.message).toContain('is already on the <Group> at line 2');
  }, 60_000);

  /**
   * The backstop. Nothing here knows that a number cannot be a string — `tsc` does, and its
   * message is better than a paraphrase. What this compiler adds is the position: the element
   * that wrote the line, in the document, rather than a line in a file nobody should open.
   */
  it('reports what tsc found in generated code at the element that wrote it', () => {
    // A spawn is the hand-off: its class is the prefab's, which this document cannot see, so the
    // slot check steps aside on purpose and `tsc` is the one that knows.
    fixture.writeXml('assets/prefabs/crate.prefab.xml', '<Group />');
    const said = check(`<Scene>
  <Prefab id="crate" src="../prefabs/crate.prefab.xml" />
  <Group><Components><Slot mesh="#crate" anything="#crate" /></Components></Group>
</Scene>`);
    expect(said.map((d) => d.code)).toEqual(['type-error']);
    // At the element that filled the slot, not at a line in a file the reader must not edit.
    expect(said[0]!.line).toBe(3);
    expect(said[0]!.message).toContain('is missing the following properties');
  }, 60_000);
});
