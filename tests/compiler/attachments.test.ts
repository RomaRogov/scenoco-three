import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * How a document says which material a node draws with.
 *
 * three.js distinguishes by where the object came from — a name shares one instance, a `new` in
 * the argument gives that node its own — and the DSL says it with a path attribute and an element.
 */
let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('attachments');
  fixture.write('tags.ts', "import 'three';\n");
  fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');
  fixture.writeXml('assets/materials/red.asset.xml', '<MeshStandardMaterial color="#ff0000" />');
  fixture.writeXml('assets/materials/blue.asset.xml', '<MeshStandardMaterial color="#0000ff" />');
});
afterAll(() => fixture.dispose());

function compile(scene: string): { code: string; diagnostics: BuildResult['diagnostics'] } {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  const result = build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true });
  const entry = [...result.files].find(([path]) => path.endsWith('main.scene.gen.ts'));
  return { code: entry?.[1] ?? '', diagnostics: result.diagnostics };
}

describe('a referenced material', () => {
  it('is one shared instance, however many nodes name it', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/red.asset.xml" />
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/red.asset.xml" />
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    // One import, and both meshes constructed from it.
    expect(code.match(/new Mesh\(cube, red\)/g)).toHaveLength(2);
    expect(code.match(/from '\.\.\/materials\/red\.asset\.gen\.js'/g)).toHaveLength(1);
  });

  it('may be a bracketed list, because `Mesh.material` is declared `Material | Material[]`', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml"
        material="[../materials/red.asset.xml, ../materials/blue.asset.xml]" />
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('new Mesh(cube, [red, blue])');
  });

  it('is refused as a list where the slot takes exactly one', () => {
    const { diagnostics } = compile(
      `<Scene>
  <Mesh geometry="[../geometry/cube.asset.xml, ../geometry/cube.asset.xml]" />
</Scene>`,
    );
    // `Mesh.geometry` is declared `BufferGeometry`, with no array alternative.
    expect(diagnostics.map((d) => d.code)).toEqual(['unsupported-list']);
  });
});

describe('an inline material', () => {
  it('is a `new` per node, so two identical ones are two instances', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml">
    <MeshStandardMaterial color="#ff0000" />
  </Mesh>
  <Mesh geometry="../geometry/cube.asset.xml">
    <MeshStandardMaterial color="#ff0000" />
  </Mesh>
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    // Two constructions, never pooled into one — that pooling is the recolour-fifty-bricks bug.
    expect(code.match(/new MeshStandardMaterial\(/g)).toHaveLength(2);
    expect(code).toMatch(/new Mesh\(cube, meshStandardMaterial\)/);
    expect(code).toMatch(/new Mesh\(cube, meshStandardMaterial\$2\)/);
  });

  it('fills the geometry slot too, and is built before the node that takes it', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh>
    <BoxGeometry width="1" height="2" depth="3" />
    <MeshStandardMaterial color="#f0b429" roughness="0.5" />
  </Mesh>
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    const geometry = code.indexOf('new BoxGeometry(1, 2, 3)');
    const material = code.indexOf('new MeshStandardMaterial(');
    const mesh = code.indexOf('new Mesh(');
    expect(geometry).toBeGreaterThan(-1);
    expect(geometry).toBeLessThan(mesh);
    expect(material).toBeLessThan(mesh);
    expect(code).toContain('new Mesh(boxGeometry, meshStandardMaterial)');
  });

  it('may be several, for a slot declared `Material | Material[]`', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml">
    <MeshStandardMaterial color="#ff0000" />
    <MeshStandardMaterial color="#0000ff" />
  </Mesh>
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('new Mesh(cube, [meshStandardMaterial, meshStandardMaterial$2])');
  });

  it('mixes with a reference in the same list', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="[../materials/red.asset.xml]">
  </Mesh>
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('new Mesh(cube, [red])');
  });
});

describe('what a node cannot be built from', () => {
  it('refuses a material on a node whose constructor takes none', () => {
    const { diagnostics } = compile(
      `<Scene>
  <PointLight color="#ffffff">
    <MeshStandardMaterial color="#ff0000" />
  </PointLight>
</Scene>`,
    );
    // Every Object3D has Material-typed *properties* (customDepthMaterial); binding to one of
    // those instead of reporting is the failure this guards.
    expect(diagnostics.map((d) => d.code)).toEqual(['unattachable']);
    expect(diagnostics[0]!.message).toContain('<PointLight> is not built from a material');
  });

  it('refuses two materials where the slot takes exactly one', () => {
    const { diagnostics } = compile(
      `<Scene>
  <Sprite>
    <SpriteMaterial color="#ff0000" />
    <SpriteMaterial color="#0000ff" />
  </Sprite>
</Scene>`,
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['one-only']);
    expect(diagnostics[0]!.message).toContain('takes one material, not 2');
  });

  it('refuses a slot filled twice, by an attribute and by an element', () => {
    const { diagnostics } = compile(
      `<Scene>
  <Mesh geometry="../geometry/cube.asset.xml" material="../materials/red.asset.xml">
    <MeshStandardMaterial color="#0000ff" />
  </Mesh>
</Scene>`,
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['duplicate-slot']);
  });
});

describe('the .asset.xml kind', () => {
  it('holds any three.js class a node is built from, whatever its family', () => {
    fixture.writeXml('assets/one.asset.xml', '<MeshBasicMaterial color="#00ff00" />');
    fixture.writeXml('assets/two.asset.xml', '<SphereGeometry radius="0.5" />');
    const { code, diagnostics } = compile(
      `<Scene><Mesh geometry="../two.asset.xml" material="../one.asset.xml" /></Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('new Mesh(two, one)');
  });

  it('refuses a node at the root, which belongs in a scene or a prefab', () => {
    fixture.writeXml('assets/bad.asset.xml', '<Mesh />');
    const { diagnostics } = compile('<Scene />');
    const reported = diagnostics.filter((d) => d.file?.endsWith('bad.asset.xml'));
    expect(reported.map((d) => d.code)).toEqual(['unknown-tag']);
    expect(reported[0]!.message).toContain('.prefab.xml');
    fixture.remove('assets/bad.asset.xml');
  });
});
