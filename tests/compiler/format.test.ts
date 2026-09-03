import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A project written the way the format is taught — the same files, the same paths, the same
 * attributes — built end to end, so the spellings anything is told to use keep working.
 */
let fixture: Fixture;
let result: BuildResult;

beforeAll(() => {
  fixture = makeFixture('dsl-doc');

  fixture.write(
    'game.ts',
    `import { Component, System } from '@scenoco-three/core';
import { Vector2 } from 'three';

export class Physics2D extends System {
  gravity = new Vector2(0, -9.81);
}

export class PaddleController extends Component {
  speed = 10;
  halfRange = 6;
}

export class Brick extends Component {
  points = 10;
}
`,
  );

  // The layout the format is taught with.
  fixture.writeXml(
    'assets/geometry/brick.geometry.xml',
    '<BoxGeometry width="1.2" height="0.4" depth="0.5" />',
  );
  fixture.writeXml(
    'assets/geometry/paddle.geometry.xml',
    '<BoxGeometry width="3" height="0.4" depth="0.5" />',
  );
  fixture.writeXml(
    'assets/materials/brick.material.xml',
    '<MeshStandardMaterial color="#e9c46a" emissive="#3a2f10" roughness="0.5" metalness="0.1" />',
  );
  fixture.writeXml(
    'assets/materials/paddle.material.xml',
    '<MeshStandardMaterial color="#38bdf8" />',
  );
  fixture.writeXml(
    'assets/scenes/brick.prefab.xml',
    `<Mesh geometry="../geometry/brick.geometry.xml"
      material="../materials/brick.material.xml">
  <Components>
    <Brick points="10" />
  </Components>
</Mesh>`,
  );
  fixture.writeXml(
    'assets/scenes/breakout.scene.xml',
    `<Scene>
  <Systems>
    <Physics2D gravity="x: 0; y: 0" />
  </Systems>

  <PerspectiveCamera id="cam" fov="45" near="0.1" far="200" position="y: 7; z: 20" />
  <AmbientLight intensity="0.5" />

  <Mesh id="paddle"
        geometry="../geometry/paddle.geometry.xml"
        material="../materials/paddle.material.xml"
        position="y: 0.5">
    <Components>
      <PaddleController speed="10" halfRange="6" />
    </Components>
  </Mesh>

  <Prefab src="brick.prefab.xml" id="b1" position="x: -6.75; y: 12" />
  <Prefab src="brick.prefab.xml" id="b2" position="x: -4.05; y: 12" />
</Scene>`,
  );

  result = build({ root: fixture.dir, tsconfig: fixture.tsconfig });
});

afterAll(() => fixture.dispose());

const read = (path: string) => readFileSync(join(fixture.dir, path), 'utf8');

describe('the documented example', () => {
  it('compiles with no diagnostics', () => {
    expect(result.diagnostics).toEqual([]);
  });

  it('produces what the file table promises', () => {
    expect(read('assets/geometry/brick.geometry.gen.ts')).toContain('export const brick =');
    expect(read('assets/materials/brick.material.gen.ts')).toContain('export const brick =');
    expect(read('assets/scenes/brick.prefab.gen.ts')).toContain('export class BrickPrefab extends Mesh');
    expect(read('assets/scenes/breakout.scene.gen.ts')).toContain('export class BreakoutScene extends Scene');
  });

  it('turns an id into a typed field and #id into a reference to it', () => {
    const scene = read('assets/scenes/breakout.scene.gen.ts');
    expect(scene).toContain('cam!: PerspectiveCamera;');
    expect(scene).toContain('paddle!: Mesh;');
    expect(scene).toContain('this.b1 = this.instantiate(BrickPrefab');
  });

  it('reads omitted axes as zero', () => {
    expect(read('assets/scenes/breakout.scene.gen.ts')).toContain('new Vector3(0, 7, 20)');
  });
});
