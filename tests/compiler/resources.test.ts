import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SceneManager, type SceneType } from '@scenoco-three/core';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * Textures, models and audio — the resources that live in files nobody authors as XML.
 *
 * The rule under all three: a path in an attribute reaches whatever is at that path. An image, a
 * glTF and a sound are already assets, so the reference is the file itself; a `.texture.xml`
 * exists for the one case where there are settings to write. What differs between them is only
 * *when* the bytes have to be there, and that decides whether a scene's `onLoad` is async.
 */
let fixture: Fixture;
let result: BuildResult;

beforeAll(() => {
  fixture = makeFixture('resources', { particles: true, audio: true });

  fixture.write(
    'game.ts',
    `import { Component } from '@scenoco-three/core';
import { AudioSource } from '@scenoco-three/audio';
import { ParticleSystem } from '@scenoco-three/particles';

export class Engine extends Component {
  override start(): void { this.getComponent(AudioSource)?.play(); }
  restart(): void { this.getComponent(ParticleSystem)?.restart(); }
}
`,
  );

  // The compiler only ever asks whether a file exists and what its extension is — it never reads
  // one — so a placeholder is a faithful stand-in for a real asset here.
  fixture.writeXml('assets/textures/brick.png', 'not really a png');
  fixture.writeXml('assets/textures/floor.png', 'not really a png');
  fixture.writeXml('assets/models/hero.glb', 'not really a glb');
  fixture.writeXml('assets/audio/engine.ogg', 'not really an ogg');

  fixture.writeXml(
    'assets/textures/floor.texture.xml',
    '<Texture src="floor.png" colorSpace="SRGBColorSpace" wrapS="RepeatWrapping" anisotropy="8" />',
  );

  // One material names the image straight; the other goes through the configured texture.
  fixture.writeXml('assets/materials/brick.asset.xml', '<MeshStandardMaterial map="../textures/brick.png" />');
  fixture.writeXml(
    'assets/materials/floor.asset.xml',
    '<MeshStandardMaterial map="../textures/floor.texture.xml" roughness="0.8" />',
  );
  fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');

  fixture.writeXml(
    'assets/vfx/spark.particle.xml',
    `<ParticleEffect duration="1" startColor="#ffdd66">
  <Renderer blending="Additive" texture="../textures/brick.png" />
</ParticleEffect>`,
  );

  // A prefab that needs a file, so it has to publish what it needs rather than await it.
  fixture.writeXml(
    'assets/scenes/enemy.prefab.xml',
    `<Group>
  <Prefab src="../models/hero.glb" position="y: 0.5" />
</Group>`,
  );
  // …and one that needs nothing, which must stay plain.
  fixture.writeXml(
    'assets/scenes/crate.prefab.xml',
    `<Mesh geometry="../geometry/cube.asset.xml" material="../materials/brick.asset.xml" />`,
  );

  fixture.writeXml(
    'assets/scenes/level.scene.xml',
    `<Scene>
  <Mesh id="floor" geometry="../geometry/cube.asset.xml" material="../materials/floor.asset.xml" />
  <Prefab src="../models/hero.glb" id="hero" position="y: 1" />
  <Prefab src="enemy.prefab.xml" position="x: 4" />
  <Prefab src="crate.prefab.xml" position="x: -4" />
  <Group>
    <Components>
      <AudioSource clip="../audio/engine.ogg" loop="true" spatial="true" />
      <Engine />
    </Components>
  </Group>
</Scene>`,
  );
  fixture.writeXml(
    'assets/scenes/menu.scene.xml',
    `<Scene>
  <Prefab src="crate.prefab.xml" />
</Scene>`,
  );

  result = build({
    root: fixture.dir,
    tsconfig: fixture.tsconfig,
    modules: ['three', '@scenoco-three/audio', '@scenoco-three/particles'],
  });
}, 60_000);

afterAll(() => fixture.dispose());

const read = (path: string) => readFileSync(join(fixture.dir, path), 'utf8');

describe('the build', () => {
  it('compiles the whole project with no diagnostics', () => {
    expect(result.diagnostics).toEqual([]);
  });

  it('produces TypeScript that typechecks against the real runtime', () => {
    // The claim everything else rests on. `sharedTexture`, `sharedModel`, `sharedClip`,
    // `loadAssets`, `instantiate(model, …)` and `static assets` all have to line up with what
    // core and the audio package actually declare — and only `tsc` can say whether they do.
    const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
    let output = '';
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '-p', fixture.tsconfig], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }
    expect(output).toBe('');
  }, 120_000);

  it('loads the scene in the real runtime, textures and all', async () => {
    // Headless there is no image to fetch and no audio to decode, and both are deliberately
    // inert rather than fatal — so a scene built from files still loads and still ticks, which
    // is what makes any of this testable without a browser.
    const module = (await import(join(fixture.dir, 'assets/scenes/menu.scene.gen.ts'))) as {
      MenuScene: SceneType;
    };
    const scene = await SceneManager.load(module.MenuScene);
    expect(scene.isLoaded).toBe(true);
    expect(scene.children).toHaveLength(1);
    await SceneManager.unloadAll();
  }, 60_000);
});

describe('textures', () => {
  it('lets a material name an image directly, sharing one texture per file', () => {
    const code = read('assets/materials/brick.asset.gen.ts');
    // `new URL(…, import.meta.url)` rather than an image import: Vite rewrites this form to the
    // hashed output path, and it needs no ambient `declare module '*.png'` to typecheck.
    expect(code).toContain(
      "const brickTexture = sharedTexture(new URL('../textures/brick.png', import.meta.url).href);",
    );
    expect(code).toContain('map: brickTexture');
  });

  it('compiles a texture document to its settings', () => {
    const code = read('assets/textures/floor.texture.gen.ts');
    expect(code).toContain("sharedTexture(new URL('floor.png', import.meta.url).href, {");
    expect(code).toContain('anisotropy: 8,');
    expect(code).toContain('colorSpace: SRGBColorSpace,');
    expect(code).toContain('wrapS: RepeatWrapping,');
  });

  it('reaches a texture document from a material by path, as an import', () => {
    const code = read('assets/materials/floor.asset.gen.ts');
    // `floor.png`, `floor.texture.xml` and `floor.asset.xml` is how anyone would name a
    // matching set, so the two `floor` exports collide — and the module renames the import
    // rather than shadowing it.
    expect(code).toContain(`import { floor as floor$2 } from '../textures/floor.texture.gen.js';`);
    expect(code).toContain('map: floor$2');
    expect(code).toContain('export const floor = shared(new MeshStandardMaterial({');
  });

  it('needs no waiting — a texture is usable before its image lands', () => {
    expect(read('assets/scenes/menu.scene.gen.ts')).not.toContain('loadAssets');
  });
});

describe('models', () => {
  it('spawns a glTF through the same <Prefab src> a prefab document uses', () => {
    const code = read('assets/scenes/level.scene.gen.ts');
    expect(code).toContain(
      "const heroModel = sharedModel(new URL('../models/hero.glb', import.meta.url).href);",
    );
    expect(code).toContain('this.hero = this.instantiate(heroModel, {');
    expect(code).toContain('hero!: Object3D;');
  });

  it('makes the scene await what it cannot build without', () => {
    const code = read('assets/scenes/level.scene.gen.ts');
    expect(code).toContain('override async onLoad(): Promise<void> {');
    // Its own files, and the ones the prefab it spawns published — in first-reference order,
    // which is the order the document mentions them.
    expect(code).toContain('await loadAssets(heroModel, ...EnemyPrefab.assets, engineClip);');
  });

  it('has a prefab publish its files instead of awaiting them', () => {
    // `instantiate` is synchronous, so a prefab has nowhere to await — it says what it needs and
    // whoever spawns it does the waiting.
    const code = read('assets/scenes/enemy.prefab.gen.ts');
    expect(code).toContain('static readonly assets = [heroModel] as const;');
    expect(code).not.toContain('async onLoad');
  });

  it('leaves a prefab that needs nothing plain, and the scene spawning it synchronous', () => {
    expect(read('assets/scenes/crate.prefab.gen.ts')).not.toContain('static readonly assets');
    const menu = read('assets/scenes/menu.scene.gen.ts');
    expect(menu).toContain('override onLoad(): void {');
    expect(menu).not.toContain('CratePrefab.assets');
  });
});

describe('audio', () => {
  it('reaches a sound file from a component field typed AudioClip', () => {
    const code = read('assets/scenes/level.scene.gen.ts');
    expect(code).toContain(
      "const engineClip = sharedClip(new URL('../audio/engine.ogg', import.meta.url).href);",
    );
    expect(code).toContain('clip: engineClip');
    expect(code).toContain('loop: true');
  });
});

describe('what it refuses', () => {
  it('reports a file that is not there, rather than emitting a 404', () => {
    const missing = makeFixture('resources-missing', { audio: true });
    // The import is what makes a dependency's vocabulary readable, and this project depends on
    // the audio package; without it the build stops on that instead of on the missing file.
    missing.write(
      'game.ts',
      `import '@scenoco-three/audio';\nimport { Component } from '@scenoco-three/core';\nexport class A extends Component {}\n`,
    );
    missing.writeXml('assets/materials/x.asset.xml', '<MeshStandardMaterial map="../textures/nope.png" />');
    const { diagnostics } = build({ root: missing.dir, tsconfig: missing.tsconfig });
    expect(diagnostics[0]?.code).toBe('unknown-asset');
    missing.dispose();
  }, 60_000);

  it('reports a texture document with no src', () => {
    const bad = makeFixture('resources-bad', {});
    bad.write('game.ts', `import { Component } from '@scenoco-three/core';\nexport class A extends Component {}\n`);
    bad.writeXml('assets/textures/x.texture.xml', '<Texture colorSpace="SRGBColorSpace" />');
    const { diagnostics } = build({ root: bad.dir, tsconfig: bad.tsconfig });
    expect(diagnostics[0]?.code).toBe('missing-src');
    bad.dispose();
  }, 60_000);

  it('reports a setting that is the loaded data rather than a setting', () => {
    const bad = makeFixture('resources-image', {});
    bad.write('game.ts', `import { Component } from '@scenoco-three/core';\nexport class A extends Component {}\n`);
    bad.writeXml('assets/textures/y.png', 'not really a png');
    bad.writeXml('assets/textures/y.texture.xml', '<Texture src="y.png" image="something.png" />');
    const { diagnostics } = build({ root: bad.dir, tsconfig: bad.tsconfig });
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    bad.dispose();
  }, 60_000);
});

describe('a particle effect names an image the same way', () => {
  it('resolves <Renderer texture> to the shared texture, not a URL string', () => {
    // `Renderer.texture` is declared `Texture`, so it is an asset reference like
    // any other — and the same image used by a material is the same object, uploaded once.
    const code = read('assets/vfx/spark.particle.gen.ts');
    expect(code).toContain(
      "const brickTexture = sharedTexture(new URL('../textures/brick.png', import.meta.url).href);",
    );
    expect(code).toContain('texture: brickTexture }');
  });
});

describe('a derived string union', () => {
  it('is read as an enum, and a value that is not one is a build error', () => {
    // The vocabulary comes from the *type*: `keyof typeof CURVES` is the union, so adding a
    // curve adds an accepted attribute value with no edit anywhere — no list in the compiler,
    // no decorator restating it, and a misspelt one caught before `tsc` sees the output.
    const fixture = makeFixture('resources-enum');
    fixture.write(
      'game.ts',
      `import { Component } from '@scenoco-three/core';

const CURVES = {
  linear: (t: number) => t,
  bounceOut: (t: number) => t * t,
} as const;

export type CurveName = keyof typeof CURVES;

export class Spin extends Component {
  curve: CurveName = 'linear';
  turns = 1;
}
`,
    );
    fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');
    fixture.writeXml('assets/materials/plain.asset.xml', '<MeshBasicMaterial color="#ffffff" />');
    fixture.writeXml(
      'assets/scenes/spin.scene.xml',
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml">
    <Components>
      <Spin curve="bounceOut" turns="2" />
    </Components>
  </Mesh>
</Scene>`,
    );
    const ok = build({ root: fixture.dir, tsconfig: fixture.tsconfig });
    expect(ok.diagnostics).toEqual([]);
    const code = readFileSync(join(fixture.dir, 'assets/scenes/spin.scene.gen.ts'), 'utf8');
    expect(code).toContain(`curve: 'bounceOut'`);
    expect(code).toContain('turns: 2');

    fixture.writeXml(
      'assets/scenes/spin.scene.xml',
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml">
    <Components>
      <Spin curve="bouncOut" />
    </Components>
  </Mesh>
</Scene>`,
    );
    const bad = build({ root: fixture.dir, tsconfig: fixture.tsconfig, model: ok.model });
    expect(bad.diagnostics[0]?.code).toBe('bad-enum');
    expect(bad.diagnostics[0]?.message).toContain('bounceOut');
    fixture.dispose();
  }, 120_000);
});
