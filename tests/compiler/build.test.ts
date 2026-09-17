import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The whole compiler, on a project that looks like a real one.
 *
 * The claim being tested is the one the architecture rests on: XML in, TypeScript out, with no
 * runtime registry, no wire format, and no hand-maintained tag table anywhere in between.
 */
let fixture: Fixture;
let result: BuildResult;

beforeAll(() => {
  fixture = makeFixture('build');

  fixture.write(
    'components/Brick.ts',
    `import { Component } from '@scenoco-three/core';

/** Awards points when the ball hits it. */
export class Brick extends Component {
  points = 10;
}
`,
  );
  fixture.write(
    'components/Ball.ts',
    `import { Component } from '@scenoco-three/core';
import { Mesh } from 'three';

export class Ball extends Component<Mesh> {
  launchSpeed = 12;
  paddle!: Mesh;
  bricks: Mesh[] = [];
}
`,
  );

  fixture.writeXml('assets/geometry/brick.asset.xml', '<BoxGeometry width="1.2" height="0.4" depth="0.5" />');
  fixture.writeXml('assets/geometry/ball.asset.xml', '<SphereGeometry radius="0.3" widthSegments="16" heightSegments="12" />');
  fixture.writeXml(
    'assets/materials/brick.asset.xml',
    '<MeshStandardMaterial color="#e9c46a" emissive="#3a2f10" roughness="0.5" metalness="0.1" />',
  );
  fixture.writeXml(
    'assets/scenes/brick.prefab.xml',
    `<Mesh geometry="../geometry/brick.asset.xml" material="../materials/brick.asset.xml">
  <Components>
    <Brick points="10" />
  </Components>
</Mesh>`,
  );
  fixture.writeXml(
    'assets/scenes/breakout.scene.xml',
    `<Scene>
  <PerspectiveCamera id="cam" fov="45" near="0.1" far="200" position="y: 7; z: 20" />
  <AmbientLight intensity="0.5" />
  <Mesh id="paddle" geometry="../geometry/brick.asset.xml" material="../materials/brick.asset.xml" position="y: 0.5" />
  <Mesh id="ball" geometry="../geometry/ball.asset.xml" material="../materials/brick.asset.xml" position="y: 1.1">
    <Components>
      <Ball launchSpeed="12" paddle="#paddle" bricks="[#b1, #b2]" />
    </Components>
  </Mesh>
  <Prefab src="brick.prefab.xml" id="b1" position="x: -6.75; y: 12" />
  <Prefab src="brick.prefab.xml" id="b2" position="x: -4.05; y: 12" />
</Scene>`,
  );

  result = build({ root: fixture.dir, tsconfig: fixture.tsconfig });
});

afterAll(() => fixture.dispose());

const read = (relativePath: string) => readFileSync(join(fixture.dir, relativePath), 'utf8');

describe('build', () => {
  it('compiles every document with no diagnostics', () => {
    expect(result.diagnostics).toEqual([]);
    expect([...result.files.keys()].map((p) => p.replace(fixture.dir + '/', '')).sort()).toEqual([
      '.scenoco/model.json',
      'assets/geometry/ball.asset.gen.ts',
      'assets/geometry/brick.asset.gen.ts',
      'assets/materials/brick.asset.gen.ts',
      'assets/scenes/breakout.scene.gen.ts',
      'assets/scenes/brick.prefab.gen.ts',
    ]);
  });

  it('finds components without executing a line of game code', () => {
    // The scan reads the source. A circular import between two components used to register a
    // broken entry; there is nothing to execute now, so the failure mode is gone.
    // `CameraFit` is core's own component, found by the same scan as the project's two.
    expect(result.model.components.map((c) => c.name).sort()).toEqual([
      'Animator',
      'AttachTo',
      'Ball',
      'Brick',
      'CameraFit',
    ]);
    expect(result.model.components.find((c) => c.name === 'Brick')?.description).toBe(
      'Awards points when the ball hits it.',
    );
  });

  it('leaves the model beside the project, for a reader with no checker of its own', () => {
    const written = JSON.parse(read('.scenoco/model.json')) as BuildResult['model'];
    // The project's own classes and the ones its packages bring, each with the fields a document
    // may write — the same model the emitters used, so the editor offers exactly what compiles.
    expect(written.components.map((c) => c.name).sort()).toEqual(result.model.components.map((c) => c.name).sort());
    const ball = written.components.find((c) => c.name === 'Ball')!;
    expect(ball.fields.map((f) => [f.name, f.shape])).toEqual([
      ['launchSpeed', 'number'],
      ['paddle', 'nodeRef'],
      ['bricks', 'array'],
    ]);
    // Where the class lives, relative to the project: the build machine's layout is no one's business.
    expect(ball.file).toBe('src/components/Ball.ts');
    expect(written.tags.some((t) => t.name === 'Mesh')).toBe(true);
  });

  it('writes each geometry as a shared module-scope value', () => {
    expect(read('assets/geometry/brick.asset.gen.ts')).toContain(
      'export const brick = shared(new BoxGeometry(1.2, 0.4, 0.5));',
    );
  });

  it('makes a prefab a real Mesh subclass that imports its assets', () => {
    const code = read('assets/scenes/brick.prefab.gen.ts');
    expect(code).toContain(`import { brick } from '../geometry/brick.asset.gen.js';`);
    expect(code).toContain(`import { brick as brick$2 } from '../materials/brick.asset.gen.js';`);
    expect(code).toContain('export class BrickPrefab extends Mesh {');
    expect(code).toContain('super(brick, brick$2);');
  });

  it('spawns prefabs from the scene through instantiate', () => {
    const code = read('assets/scenes/breakout.scene.gen.ts');
    expect(code).toContain(`import { BrickPrefab } from './brick.prefab.gen.js';`);
    expect(code).toContain('this.b1 = this.instantiate(BrickPrefab, { position: new Vector3(-6.75, 12, 0) });');
  });

  it('imports components by a path relative to the generated file', () => {
    const code = read('assets/scenes/breakout.scene.gen.ts');
    expect(code).toContain(`from '../../src/components/Ball.js'`);
    expect(code).toContain('bricks: [this.b1, this.b2]');
  });

  it('rewrites nothing when the sources have not changed', () => {
    const before = read('assets/scenes/breakout.scene.gen.ts');
    build({ root: fixture.dir, tsconfig: fixture.tsconfig, model: result.model });
    expect(read('assets/scenes/breakout.scene.gen.ts')).toBe(before);
  });
});

describe('a document of a kind nothing declares', () => {
  it('is reported, rather than walked past in silence', () => {
    // The worst possible failure: no output, no message, and the breakage lands wherever the
    // effect was named. This project has no VFX package, so nothing says what a `.particle.xml`
    // even is — and that is exactly what it should be told.
    fixture.writeXml('assets/vfx/fire.particle.xml', '<ParticleEffect duration="3" />');
    const { diagnostics } = build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true });
    const unknown = diagnostics.find((d) => d.code === 'unknown-document');
    expect(unknown?.message).toContain('".particle.xml"');
    expect(unknown?.file).toBe('assets/vfx/fire.particle.xml');
    fixture.remove('assets/vfx/fire.particle.xml');
  });
});
