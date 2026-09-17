import { afterEach, describe, expect, it } from 'vitest';
import { build, MODEL_FILE } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A **preview** is the one piece of a project's own code an editor may run.
 *
 * A component's effect is normally only visible in the running game, and no editor can honestly
 * show it. The exception is the component whose job is to put geometry in the world: it names a
 * module that turns its authored attributes into an `Object3D`, and an editor draws that. What
 * keeps this from being "run the game in the editor" is how little the module is allowed to be —
 * one file, already JavaScript, importing nothing but `three`.
 */
let fixture: Fixture | undefined;

afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const PREVIEW = `import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

export default function preview(props) {
  return new Mesh(new BoxGeometry(props.size ?? 1, 1, props.size ?? 1), new MeshStandardMaterial());
}
`;

/** A project with one component, and whatever it says about previews in its own manifest. */
function project(scenoco: Record<string, unknown>, previewSource = PREVIEW): Fixture {
  const made = makeFixture('preview', { scenoco });
  made.write(
    'Terrain.ts',
    `import { Component } from '@scenoco-three/core';\nexport class Terrain extends Component {\n  size = 4;\n}\n`,
  );
  if (previewSource) made.write('terrain.preview.js', previewSource);
  return made;
}

const compiled = (f: Fixture) => build({ root: f.dir, tsconfig: f.tsconfig, dryRun: true });
const model = (result: ReturnType<typeof compiled>, dir: string) =>
  JSON.parse([...result.files].find(([path]) => path.endsWith(MODEL_FILE))![1]) as {
    components: Array<{ name: string; preview?: string }>;
  };

describe('a component preview', () => {
  it('is copied where an editor can fetch it, and named in the model', () => {
    fixture = project({ previews: { Terrain: './src/terrain.preview.js' } });
    const result = compiled(fixture);
    expect(result.diagnostics).toEqual([]);

    const copied = [...result.files].find(([path]) => path.endsWith('.scenoco/previews/Terrain.js'));
    // The copy imports nothing: whoever serves it may not serve it verbatim, and a module with
    // nothing to resolve is one a dev server cannot rewrite into something unresolvable.
    expect(copied?.[1]).toContain('const { BoxGeometry, Mesh, MeshStandardMaterial } = globalThis.__scenocoThree;');
    expect(copied?.[1]).not.toContain("from 'three'");
    expect(copied?.[1]).toContain('export default function preview');
    expect(model(result, fixture.dir).components.find((c) => c.name === 'Terrain')?.preview).toBe(
      '.scenoco/previews/Terrain.js',
    );
  });

  it('leaves every other component alone', () => {
    fixture = project({ previews: { Terrain: './src/terrain.preview.js' } });
    fixture.write(
      'Spinner.ts',
      `import { Component } from '@scenoco-three/core';\nexport class Spinner extends Component {\n  speed = 1;\n}\n`,
    );
    const found = model(compiled(fixture), fixture.dir).components;
    expect(found.find((c) => c.name === 'Spinner')?.preview).toBeUndefined();
  });

  /**
   * The rule that keeps this from becoming "the editor runs your game". An editor is a page: it
   * can fetch a module and import it, and it has neither a bundler nor anything but `three` to
   * resolve against.
   */
  it('refuses one that imports anything but three, naming what it imported', () => {
    fixture = project(
      { previews: { Terrain: './src/terrain.preview.js' } },
      `import { Component } from '@scenoco-three/core';\nexport default function preview() { return null; }\n`,
    );
    const { diagnostics } = compiled(fixture);
    expect(diagnostics[0]?.code).toBe('preview');
    expect(diagnostics[0]?.message).toContain('@scenoco-three/core');
  });

  it('refuses TypeScript, because nothing between the file and the editor compiles it', () => {
    fixture = project({ previews: { Terrain: './src/terrain.preview.ts' } });
    const { diagnostics } = compiled(fixture);
    expect(diagnostics[0]?.message).toContain('`.js`');
  });

  it('says so when the file named is not there', () => {
    fixture = project({ previews: { Terrain: './src/gone.js' } });
    const { diagnostics } = compiled(fixture);
    expect(diagnostics[0]?.message).toContain('./src/gone.js');
  });

  it('says so when the name is not a component of this project', () => {
    fixture = project({ previews: { Terrian: './src/terrain.preview.js' } });
    const { diagnostics } = compiled(fixture);
    expect(diagnostics[0]?.message).toContain('not a component');
  });
});
