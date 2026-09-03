import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  emitGraph,
  parseDocument,
  scanComponents,
  scanEffects,
  scanSystems,
  scanTags,
  whatToLookUp,
  type ProjectModel,
  type SncDiagnostic,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The DSL's contract with a *small* model: one spelling per value, nothing silently ignored,
 * no meaning that depends on attribute order, and every near miss answered with the exact text
 * to write instead.
 *
 * Each case here is a mistake something will actually make. What is being asserted is not that
 * it fails, but that it fails *legibly* — a diagnostic a model can act on without guessing.
 */
let fixture: Fixture;
let model: ProjectModel;

beforeAll(() => {
  fixture = makeFixture('legibility');
  fixture.write(
    'game.ts',
    `import { Component, System } from '@scenoco-three/core';
import { Color, Vector2 } from 'three';

export class Brick extends Component {
  points = 10;
  tint = new Color('#ffffff');
}

export class Physics2D extends System {
  gravity = new Vector2(0, -9.81);
}
`,
  );
  model = Workspace.with(fixture.tsconfig, (w) => ({
    components: scanComponents(w),
    systems: scanSystems(w),
    effects: scanEffects(w),
    tags: scanTags(w),
  }));
});

afterAll(() => fixture.dispose());

function emit(kind: 'scene' | 'prefab', xml: string) {
  const parsed = parseDocument(xml, 'doc.xml');
  if (!parsed.ok) return { code: undefined, diagnostics: parsed.diagnostics };
  return emitGraph(parsed.root, {
    kind,
    name: 'Doc',
    source: 'doc.xml',
    model,
    resolveAsset: () => undefined,
  });
}

const first = (diagnostics: SncDiagnostic[]) => diagnostics[0];
const codes = (diagnostics: SncDiagnostic[]) => diagnostics.map((d) => d.code);

describe('one spelling per value', () => {
  /**
   * The hint economy: one answer per problem, and a pointer only where no answer fits.
   *
   * A misspelling is worth answering on the line — it *is* the fix. A tag with thirty attributes
   * is not, and a truncated list of them is worse than nothing, so it defers to the summary.
   * Emitting both trains a reader to skim past both, which is the failure this ordering exists
   * to prevent.
   */
  it('answers a misspelling on the line, and asks nothing further', () => {
    const { diagnostics } = emit('scene', `<Scene><Group positon="y: 1" /></Scene>`);
    const [problem] = diagnostics;
    expect(problem?.message).toContain('Did you mean "position"?');
    expect(problem?.ask, 'a hint that answers the question makes the pointer noise').toBeUndefined();
  });

  it('points at `describe` when the vocabulary is too big to name', () => {
    // `rotation` is not an attribute here — the DSL spells it `eulerAngles` — so there is no near
    // miss to offer, and <Mesh> has far too many attributes to list.
    const { diagnostics } = emit(
      'scene',
      `<Scene><Mesh geometry="g.geometry.xml" material="m.material.xml" rotaton="x: 1" /></Scene>`,
    );
    const problem = diagnostics.find((d) => d.code === 'unknown-attribute');
    expect(problem?.message).not.toContain('Did you mean');
    expect(problem?.ask).toBe('Mesh');
  });

  it('names each thing to look up once, however often it was wrong', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene>
         <Mesh geometry="g.geometry.xml" material="m.material.xml" rotaton="x: 1" />
         <Mesh geometry="g.geometry.xml" material="m.material.xml" opacty="1" />
       </Scene>`,
    );
    expect(whatToLookUp(diagnostics)).toEqual(['Mesh']);
  });

  it('takes the axis form for a vector and hands back the rewrite for a positional one', () => {
    const bad = emit('scene', `<Scene><Group position="1 2 3" /></Scene>`);
    expect(first(bad.diagnostics)?.code).toBe('bad-vector');
    // The fix, verbatim — a near miss should cost one line, not a search.
    expect(first(bad.diagnostics)?.message).toContain('Write position="x: 1; y: 2; z: 3"');

    const good = emit('scene', `<Scene><Group position="x: 1; y: 2; z: 3" /></Scene>`);
    expect(good.diagnostics).toEqual([]);
    expect(good.code).toContain('new Vector3(1, 2, 3)');
  });

  it('takes #rrggbb for a colour and hands back the rewrite for JavaScript notation', () => {
    const bad = emit(
      'scene',
      `<Scene><Group><Components><Brick tint="0xff0000" /></Components></Group></Scene>`,
    );
    expect(first(bad.diagnostics)?.code).toBe('bad-color');
    expect(first(bad.diagnostics)?.message).toContain('write tint="#ff0000"');
  });

  it('names the axes it does have when the document names one it does not', () => {
    const bad = emit(
      'scene',
      `<Scene><Systems><Physics2D gravity="x: 0; z: 5" /></Systems></Scene>`,
    );
    // A Vector2 has x and y. Saying which axes exist beats "invalid vector".
    expect(first(bad.diagnostics)?.message).toContain('this value has x, y');
  });
});

describe('nothing is silently ignored', () => {
  it('reports a <Systems> block in a prefab, where it would never be read', () => {
    const { diagnostics } = emit('prefab', `<Group><Systems><Physics2D /></Systems></Group>`);
    expect(codes(diagnostics)).toContain('systems-in-prefab');
    expect(first(diagnostics)?.message).toContain('Declare it in the scene');
  });

  it('reports a <Systems> block hanging off a node instead of the scene', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group id="g"><Systems><Physics2D /></Systems></Group></Scene>`,
    );
    expect(codes(diagnostics)).toContain('misplaced-systems');
    expect(first(diagnostics)?.message).toContain('Move the block up to <Scene>');
  });

  it('reports text between tags, since every value here is an attribute', () => {
    const { diagnostics } = emit('scene', `<Scene><Group>hello</Group></Scene>`);
    expect(codes(diagnostics)).toContain('text-content');
    expect(first(diagnostics)?.message).toContain('every value in a SceNoCo document is an attribute'.slice(6));
  });

  it('names a markdown fence for what it is, since that is what a model leaves behind', () => {
    const { diagnostics } = emit('scene', '<Scene><Group>```xml</Group></Scene>');
    expect(codes(diagnostics)).toContain('text-content');
    expect(first(diagnostics)?.message).toContain('markdown code fence');
  });
});

describe('a document means one thing regardless of attribute order', () => {
  it('applies placement in a fixed order, so active always has the final say', () => {
    // `setActive` writes `visible` too. In document order these two would differ.
    const a = emit('scene', `<Scene><Group active="false" visible="true" /></Scene>`);
    const b = emit('scene', `<Scene><Group visible="true" active="false" /></Scene>`);
    expect(a.code).toBe(b.code);
    expect(a.code).toContain('node1.visible = true;\n    node1.setActive(false);');
  });
});

describe('ids are handles, wherever they are', () => {
  it('declares a typed field for a component id, not just for a node id', () => {
    // Without the field, generated code assigns to something nothing declared — a `tsc` error
    // inside a generated file, which is the worst place to meet one.
    const { code, diagnostics } = emit(
      'scene',
      `<Scene><Group id="hud"><Components><Brick id="scoreboard" points="5" /></Components></Group></Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('hud!: Group;');
    expect(code).toContain('scoreboard!: Brick;');
    expect(code).toContain('this.scoreboard = this.hud.addComponent(Brick, { points: 5 });');
  });
});

describe('a near miss is answered, and so is a wild guess', () => {
  it('suggests the field when the attribute is a misspelling', () => {
    const { diagnostics } = emit('scene', `<Scene><Group><Components><Brick pints="3" /></Components></Group></Scene>`);
    expect(codes(diagnostics)).toEqual(['unknown-attribute']);
    expect(first(diagnostics)?.message).toContain('Did you mean "points"?');
  });

  it('names the whole vocabulary when the attribute came from somewhere else', () => {
    // Borrowed from another class rather than mistyped, so there is nothing to suggest — and
    // the component lives in a package, where a reader cannot go looking. Naming what it does
    // take is the only answer that leaves something to do.
    const { diagnostics } = emit('scene', `<Scene><Group><Components><Brick strength="1" /></Components></Group></Scene>`);
    expect(codes(diagnostics)).toEqual(['unknown-attribute']);
    expect(first(diagnostics)?.message).toContain('It takes: points, tint.');
  });
});

describe('names describe what is there', () => {
  it('spawns a prefab with <Prefab src="…">', () => {
    const { diagnostics } = emit('scene', `<Scene><Prefab src="brick.prefab.xml" /></Scene>`);
    // No asset resolver in this fixture, so the reference fails — but on the *asset*, which
    // means the tag itself was understood.
    expect(codes(diagnostics)).toEqual(['unknown-asset']);
  });

  it('answers the old <PrefabInstance> with the new spelling', () => {
    // v1 wrapped every spawn in a node. The wrapper is gone, so the name would describe
    // something that does not exist — and a document written against it deserves better than
    // "unknown tag".
    const { diagnostics } = emit('scene', `<Scene><PrefabInstance src="brick.prefab.xml" /></Scene>`);
    expect(first(diagnostics)?.code).toBe('renamed-tag');
    expect(first(diagnostics)?.message).toContain('<PrefabInstance> is now <Prefab>');
  });
});
