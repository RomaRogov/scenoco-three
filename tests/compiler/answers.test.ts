import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, parseDocument } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * Refusals that used to stop at "no".
 *
 * Each of these named a real mistake and left the reader to work out the fix — and each fix was
 * something the compiler already knew. A message that says only what is wrong costs a detour
 * every time it is read, which for an agent in a loop is the whole budget.
 */
describe('a document that is not XML', () => {
  const parse = (xml: string) => {
    const result = parseDocument(xml, 'assets/scenes/main.scene.xml');
    return result.ok ? [] : result.diagnostics;
  };

  it('reports one error, once, with the file on it', () => {
    // saxes reports this one three times and then cascades; a parser that has lost the shape of
    // the document is guessing about everything after it.
    const said = parse(`<Scene>\n  <PerspectiveCamera fov="1">\n  </PerspectivCamera>\n</Scene>\n`);
    expect(said).toHaveLength(1);
    expect(said[0]!.file).toBe('assets/scenes/main.scene.xml');
    expect(said[0]!.line).toBe(3);
    expect(said[0]!.message).toContain('</PerspectivCamera> closes nothing');
    expect(said[0]!.message).toContain('<PerspectiveCamera>, from line 2');
    // The position belongs to the diagnostic, not to the text of it.
    expect(said[0]!.message).not.toContain(':3:');
  });

  it('points at the "&" itself, not at the end of the file', () => {
    const said = parse(`<Scene>\n  <Text text="you & me" />\n</Scene>\n`);
    expect(said[0]!.line).toBe(2);
    expect(said[0]!.message).toBe('An "&" on its own is not XML. Write "&amp;".');
  });

  it('says how to write a "<" inside a value', () => {
    const said = parse(`<Scene>\n  <Text text="a < b" />\n</Scene>\n`);
    expect(said[0]!.message).toBe('A "<" inside a value starts a tag. Write "&lt;".');
  });
});

let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('answers');
  fixture.write(
    'game.ts',
    `import { Component } from '@scenoco-three/core';

export class Spawner extends Component {
  limit = 12;
  private count = 0;
  readonly kind = 'crate';
  get dropped(): number {
    return this.count;
  }
}
`,
  );
});
afterAll(() => fixture.dispose());

function check(scene: string): Array<{ code: string; message: string }> {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  return build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true }).diagnostics.map(
    ({ code, message }) => ({ code, message }),
  );
}

describe('a name that is right, in a place that is wrong', () => {
  it('spells the attribute three.js has under another name', () => {
    const [said] = check(`<Scene><Group rotation="x: 45" /></Scene>`);
    expect(said?.code).toBe('unknown-attribute');
    expect(said?.message).toContain('eulerAngles="x: 0; y: 45; z: 0"');
    expect(said?.message).toContain('in degrees');
  }, 60_000);

  it('sends `enabled` to code and `active` to the node', () => {
    const on = check(`<Scene><Group><Components><Spawner enabled="false" /></Components></Group></Scene>`);
    expect(on[0]?.code).toBe('unauthored-field');
    expect(on[0]?.message).toContain('this.enabled = false');
    expect(on[0]?.message).toContain('active="false" on the node');

    const active = check(`<Scene><Group><Components><Spawner active="false" /></Components></Group></Scene>`);
    expect(active[0]?.message).toContain('belongs to the node');
  }, 60_000);

  it('says why a member it can see is still not an attribute', () => {
    const why = (attribute: string) =>
      check(`<Scene><Group><Components><Spawner ${attribute}="1" /></Components></Group></Scene>`)[0]?.message ?? '';
    expect(why('count')).toContain('it is private');
    expect(why('count')).toContain('@serializeField');
    expect(why('dropped')).toContain('it is a getter');
    expect(why('kind')).toContain('it is readonly');
  }, 60_000);

  it('puts fog in the document that owns how a scene is drawn', () => {
    const [said] = check(`<Scene fog="#889899" />`);
    expect(said?.code).toBe('misplaced-fog');
    expect(said?.message).toContain('<Render><Fog');
    expect(said?.message).toContain('.render.xml');
  }, 60_000);

  it('says what an #id names, when a path was wanted', () => {
    const [said] = check(`<Scene><Mesh material="#steel" /></Scene>`);
    expect(said?.code).toBe('unknown-asset');
    expect(said?.message).toContain('names a node in this document');
    expect(said?.message).toContain('or the element itself, written inside this one');
  }, 60_000);

  it('knows a <Components> inside a <Components> is the block, not a component', () => {
    const [said] = check(`<Scene><Group><Components><Components /></Components></Group></Scene>`);
    expect(said?.code).toBe('nested-block');
    expect(said?.message).toContain('One <Components> per node');
  }, 60_000);

  it('names the file when a class the scan never saw is sitting in the project', () => {
    fixture.writeXml('outside/Turret.ts', `export class Turret {}\n`);
    const [said] = check(`<Scene><Group><Components><Turret /></Components></Group></Scene>`);
    fixture.remove('outside/Turret.ts');
    expect(said?.code).toBe('unknown-component');
    expect(said?.message).toContain('outside/Turret.ts is named after it');
    expect(said?.message).toContain('"include" does not cover that directory');
  }, 60_000);
});
