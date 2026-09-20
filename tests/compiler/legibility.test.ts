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
import { nearestName } from '../../packages/compiler/src/dsl/diagnostics.js';
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
  fixture = makeFixture('legibility', { ui: true });
  fixture.write(
    'game.ts',
    `import { Component, System } from '@scenoco-three/core';
import { Canvas } from '@scenoco-three/ui';
import { Color, Vector2 } from 'three';

// A real import, or the module's tags never resolve — the same trick package-tags.test.ts uses.
export const uiInUse = Canvas;

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
    tags: scanTags(w, ['three', '@scenoco-three/ui']),
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

  it('suggests the option a value starts with over the sibling fewest edits away', () => {
    // `stretchCenter` was answered "Did you mean stretchLeft?"; it is `stretch` with a word on it.
    const anchors = ['stretch', 'stretchLeft', 'stretchRight', 'stretchTop', 'stretchBottom', 'center'];
    expect(nearestName('stretchCenter', anchors)).toBe('stretch');
    // A one-letter typo still wins.
    expect(nearestName('strech', anchors)).toBe('stretch');
    expect(nearestName('stretchLeftt', anchors)).toBe('stretchLeft');
  });

  it('points at `describe` when the vocabulary is too big to name', () => {
    // `rotation` is not an attribute here — the DSL spells it `eulerAngles` — so there is no near
    // miss to offer, and <Mesh> has far too many attributes to list.
    const { diagnostics } = emit(
      'scene',
      `<Scene><Mesh geometry="g.asset.xml" material="m.asset.xml" rotaton="x: 1" /></Scene>`,
    );
    const problem = diagnostics.find((d) => d.code === 'unknown-attribute');
    expect(problem?.message).not.toContain('Did you mean');
    expect(problem?.ask).toBe('Mesh');
  });

  it('names each thing to look up once, however often it was wrong', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene>
         <Mesh geometry="g.asset.xml" material="m.asset.xml" rotaton="x: 1" />
         <Mesh geometry="g.asset.xml" material="m.asset.xml" opacty="1" />
       </Scene>`,
    );
    expect(whatToLookUp(diagnostics)).toEqual(['Mesh']);
  });

  it('builds a bare Object3D as a node, the way three.js scenes use one', () => {
    const { code, diagnostics } = emit('scene', `<Scene><Object3D id="holder" position="x: 1" /></Scene>`);
    expect(diagnostics).toEqual([]);
    expect(code).toMatch(/this\.holder = new \w*Object3D\(\)/);
  });

  it('takes the axis form for a vector and hands back the rewrite for a positional one', () => {
    const bad = emit('scene', `<Scene><Group position="1 2 3" /></Scene>`);
    expect(first(bad.diagnostics)?.code).toBe('bad-vector');
    // The fix, verbatim — a near miss should cost one line, not a search.
    expect(first(bad.diagnostics)?.message).toContain('Write position="x: 1; y: 2; z: 3"');
    // The separator the axis form itself uses, which is the one a model reaches for.
    const half = emit('scene', `<Scene><Group scale="0.6; y: 1.2; z: 0.8" /></Scene>`);
    expect(first(half.diagnostics)?.message).toContain('Write scale="x: 0.6; y: 1.2; z: 0.8"');
    const semicolons = emit('scene', `<Scene><Group scale="0.4; 0.4; 0.4" /></Scene>`);
    expect(first(semicolons.diagnostics)?.message).toContain('Write scale="x: 0.4; y: 0.4; z: 0.4"');

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
    expect(first(bad.diagnostics)?.message).toContain('Write tint="#ff0000"');
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

  /**
   * The failure this diagnostic exists for: a `<Canvas>` written where every other node goes
   * compiles, runs, and draws nothing at all. A build spent forty turns on it, past a console
   * message it had no way to see.
   */
  it('reports a <Canvas> that is not under a camera, and names the camera to move it into', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene camera="#camera">
         <PerspectiveCamera id="camera" />
         <Canvas id="hud" />
       </Scene>`,
    );
    expect(codes(diagnostics)).toContain('misplaced-canvas');
    expect(first(diagnostics)?.message).toContain('has to be a child of a camera');
    expect(first(diagnostics)?.message).toContain('Move it inside #camera');
    // Which tags hang off a camera, and what to add about them, is ui's to say — in its JSDoc.
    expect(first(diagnostics)?.message).toContain('A Canvas fills the view of the camera it hangs off');
  });

  it('adds what a package says about a value, from the @tip on its declaration', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene camera="#camera">
         <PerspectiveCamera id="camera"><Canvas><Panel width="100%" /></Canvas></PerspectiveCamera>
       </Scene>`,
    );
    expect(first(diagnostics)?.message).toBe(
      'width="100%" is not a number. A size is pixels, never a percentage or "auto": to fill the parent, ' +
        'anchor it (anchor="stretch", "stretchTop", …); to fit what it holds, leave width off.',
    );
  });

  it('says nothing about a <Canvas> that is under one', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene camera="#camera">
         <PerspectiveCamera id="camera"><Canvas id="hud" /></PerspectiveCamera>
       </Scene>`,
    );
    expect(codes(diagnostics)).not.toContain('misplaced-canvas');
  });

  it('reports a <Canvas> on a camera the scene is not seen through', () => {
    // A second camera for the UI, as a Unity scene might have: nothing renders through it, so the
    // whole interface was missing from a build whose document compiled clean.
    const { diagnostics } = emit(
      'scene',
      `<Scene camera="#camera">
         <PerspectiveCamera id="camera" />
         <PerspectiveCamera id="uiCamera"><Canvas id="hud" /></PerspectiveCamera>
       </Scene>`,
    );
    expect(first(diagnostics)?.code).toBe('misplaced-canvas');
    expect(first(diagnostics)?.message).toContain('seen through camera="#camera"');
    expect(first(diagnostics)?.message).toContain('Move it inside #camera');
  });

  it('reports text between tags, since every value here is an attribute', () => {
    const { diagnostics } = emit('scene', `<Scene><Group>hello</Group></Scene>`);
    expect(codes(diagnostics)).toContain('text-content');
    expect(first(diagnostics)?.message).toContain('every value in a SceNoCo document is an attribute'.slice(6));
  });

  it('reads a lower-case element holding text as an attribute written as a child', () => {
    const { diagnostics } = emit('scene', `<Scene><Group><name>door</name></Group></Scene>`);
    const message = diagnostics.find((d) => d.code === 'text-content')?.message;
    expect(message).toContain('Write it on <Group> as name="…".');
  });

  it('names a markdown fence for what it is, since that is what a model leaves behind', () => {
    const { diagnostics } = emit('scene', '<Scene><Group>```xml</Group></Scene>');
    expect(codes(diagnostics)).toContain('text-content');
    expect(first(diagnostics)?.message).toContain('markdown code fence');
  });
});

describe('a document means one thing regardless of attribute order', () => {
  it('applies placement in a fixed order', () => {
    // Whatever order they were written in, one document means one thing.
    const a = emit('scene', `<Scene><Group active="false" position="y: 2" /></Scene>`);
    const b = emit('scene', `<Scene><Group position="y: 2" active="false" /></Scene>`);
    expect(a.code).toBe(b.code);
    expect(a.code).toContain('node1.setActive(false);');
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
});

/**
 * A name can be unknown for a reason that has nothing to do with spelling: the package is
 * installed and the compiler reads no vocabulary from it, because it declares none.
 *
 * "There is no such tag" is true and useless there — it sent one run into rewriting a HUD by hand
 * rather than installing the package that already had one.
 */
describe('a package that is present and not a module', () => {
  const plainPackages = ['@acme/widgets'];

  const emitWith = (xml: string) => {
    const parsed = parseDocument(xml, 'main.scene.xml');
    if (!parsed.ok) throw new Error('fixture does not parse');
    return emitGraph(parsed.root, {
      kind: 'scene',
      name: 'MainScene',
      source: 'main.scene.xml',
      model,
      plainPackages,
      resolveAsset: () => undefined,
    }).diagnostics;
  };

  it('is named beside the tag it might explain', () => {
    const diagnostics = emitWith(`<Scene><Widget /></Scene>`);
    expect(first(diagnostics)?.message).toContain('"@acme/widgets" is a dependency');
    expect(first(diagnostics)?.message).toContain('no "scenoco" block');
  });

  it('is said once per document, not once per element', () => {
    const diagnostics = emitWith(`<Scene><Widget /><Widget /><Widget /></Scene>`);
    const said = diagnostics.filter((d) => d.message.includes('@acme/widgets'));
    expect(said).toHaveLength(1);
    expect(diagnostics.length).toBeGreaterThan(1);
  });

  it('says nothing when every dependency is a module', () => {
    const parsed = parseDocument(`<Scene><Widget /></Scene>`, 'main.scene.xml');
    if (!parsed.ok) throw new Error('fixture does not parse');
    const { diagnostics } = emitGraph(parsed.root, {
      kind: 'scene',
      name: 'MainScene',
      source: 'main.scene.xml',
      model,
      resolveAsset: () => undefined,
    });
    expect(first(diagnostics)?.message).not.toContain('scenoco" block');
  });
});

/**
 * three.js spells a constant as `declare const AdditiveBlending: 2` plus
 * `type Blending = typeof NoBlending | …`, so the *type* carries only numbers — and a document
 * writes the name, which is what the generated code imports.
 *
 * Read as numbers, the vocabulary was both unhelpful and wrong: `describe` offered `0 | 1 | … | 6`
 * and the compiler then refused `blending="2"` for not being one of `0, 1, 2, …, 6`.
 */
describe('a union of three.js constants', () => {
  const blending = () =>
    model.tags.find((t) => t.name === 'MeshStandardMaterial')?.properties.find((p) => p.name === 'blending');

  it('is offered by name, because the name is what a document writes', () => {
    expect(blending()?.options).toContain('AdditiveBlending');
    expect(blending()?.options).not.toContain('2');
  });

  const material = (written: string) =>
    emit('scene', `<Scene><Mesh><MeshStandardMaterial ${written} /></Mesh></Scene>`).diagnostics;

  it('takes the name', () => {
    expect(codes(material('blending="AdditiveBlending"'))).toEqual([]);
  });

  it('refuses the number, and says what to write instead', () => {
    const diagnostics = material('blending="2"');
    expect(codes(diagnostics)).toEqual(['bad-enum']);
    expect(first(diagnostics)?.message).toContain('NoBlending, NormalBlending, AdditiveBlending');
  });

  it('answers a near miss with the name', () => {
    expect(first(material('blending="AdditiveBlendng"'))?.message).toContain(
      'Did you mean AdditiveBlending?',
    );
  });
});
