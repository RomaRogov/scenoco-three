import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * `DSL.md` is the page something reads before writing its first document, so it is the one
 * place a wrong claim costs the most. This builds a project laid out exactly as that page shows
 * — the same files, the same paths, the same attributes — so the documentation cannot drift
 * from the compiler without a test going red.
 */
let fixture: Fixture;
let result: BuildResult;

const DOC = fileURLToPath(new URL('../../packages/compiler/DSL.md', import.meta.url));

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

  // Verbatim from DSL.md.
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

describe('DSL.md itself', () => {
  const doc = readFileSync(DOC, 'utf8');

  it('lists every diagnostic code the compiler can emit', () => {
    // A code the page does not mention is one nothing can look up.
    const emitted = new Set<string>();
    for (const file of [
      'emit/graph.ts',
      'emit/render.ts',
      'emit/resource.ts',
      'emit/config.ts',
      'dsl/value.ts',
      'dsl/parse.ts',
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../../packages/compiler/src/${file}`, import.meta.url)),
        'utf8',
      );
      for (const match of source.matchAll(/(?:code: |at\(|report\(\s*\w+,\s*)'([a-z][a-z-]+)'/g)) {
        emitted.add(match[1]!);
      }
    }
    // Codes the page covers by category rather than by name.
    const grouped = new Set(['bad-number', 'bad-boolean', 'bad-color', 'bad-vector', 'bad-enum',
      'bad-array', 'bad-root', 'unsupported-type', 'unsupported-list', 'missing-src',
      'unexpected-child', 'unknown-module', 'missing-package', 'xml-syntax', 'empty-document']);

    const missing = [...emitted].filter((code) => !grouped.has(code) && !doc.includes(code));
    expect(missing).toEqual([]);
  });

  it('shows only spellings the compiler accepts', () => {
    // Every `attr="…"` in the page's examples went through the build above; this guards the
    // tables, where a stale example would otherwise sit unexercised.
    expect(doc).not.toMatch(/position="[-\d]/);
    expect(doc).not.toMatch(/color="0x/);
    expect(doc).not.toContain('<Attachments>');
    expect(doc).not.toContain('<PrefabInstance ');
  });
});
