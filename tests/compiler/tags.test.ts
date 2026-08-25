import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Workspace, scanTags, type TagInfo } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The tag vocabulary comes from `three`'s own declarations, not from a table in this repo.
 * These cases pin the derivation, because "the attribute list is the constructor" is the claim
 * that lets `nodes/**` be deleted.
 */
let fixture: Fixture;
let tags: Map<string, TagInfo>;

beforeAll(() => {
  fixture = makeFixture('tags');
  fixture.write('game.ts', `import { Mesh } from 'three';\nexport const m = new Mesh();\n`);
  const found = Workspace.with(fixture.tsconfig, (w) => scanTags(w));
  tags = new Map(found.map((t) => [t.name, t]));
});

afterAll(() => fixture.dispose());

describe('tag scan', () => {
  it('finds the node, geometry and material families', () => {
    expect(tags.get('Mesh')?.family).toBe('node');
    expect(tags.get('PerspectiveCamera')?.family).toBe('node');
    expect(tags.get('DirectionalLight')?.family).toBe('node');
    expect(tags.get('BoxGeometry')?.family).toBe('geometry');
    expect(tags.get('MeshStandardMaterial')?.family).toBe('material');
  });

  it('takes a geometry’s attributes from its constructor parameters, in order', () => {
    const box = tags.get('BoxGeometry')!;
    expect(box.parameters.map((p) => p.name)).toEqual([
      'width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments',
    ]);
    expect(box.parameters.every((p) => p.shape === 'number')).toBe(true);
    // A geometry is entirely its constructor; there is nothing to set afterwards.
    expect(box.properties).toEqual([]);
  });

  it('takes a material’s attributes from its parameters interface', () => {
    const standard = tags.get('MeshStandardMaterial')!;
    const byName = new Map(standard.properties.map((p) => [p.name, p]));
    expect(byName.get('color')?.shape).toBe('color');
    expect(byName.get('roughness')?.shape).toBe('number');
    expect(byName.get('transparent')?.shape).toBe('boolean');
    expect(byName.get('map')?.shape).toBe('assetRef');
    expect(byName.get('side')?.shape).toBe('enum');
  });

  it('reads a camera’s constructor and its extra settable properties', () => {
    const camera = tags.get('PerspectiveCamera')!;
    expect(camera.parameters.map((p) => p.name)).toEqual(['fov', 'aspect', 'near', 'far']);
    expect(camera.properties.map((p) => p.name)).toContain('zoom');
    expect(camera.bases).toContain('Object3D');
  });

  it('reads a light’s colour parameter as a colour', () => {
    const light = tags.get('DirectionalLight')!;
    expect(light.parameters.map((p) => p.name)).toEqual(['color', 'intensity']);
    expect(light.parameters[0]!.shape).toBe('color');
    expect(light.parameters[1]!.shape).toBe('number');
  });

  it('leaves out abstract bases and non-class exports', () => {
    expect(tags.has('Object3D')).toBe(false);
    expect(tags.has('Material')).toBe(false);
    expect(tags.has('BufferGeometry')).toBe(false);
    // Constants share the module and are not tags.
    expect(tags.has('FrontSide')).toBe(false);
  });

  it('never exposes a node’s transform as a tag property', () => {
    // Placement is the one attribute set every *node* shares, applied by the emitter — a tag
    // that also offered `position` would give a document two spellings for one thing.
    // Materials are exempt: `LineDashedMaterial.scale` is a dash scale, not a transform.
    for (const tag of tags.values()) {
      if (tag.family !== 'node') continue;
      const names = tag.properties.map((p) => p.name);
      expect(names).not.toContain('position');
      expect(names).not.toContain('rotation');
      expect(names).not.toContain('scale');
    }
  });
});

describe('generic slots', () => {
  it('reads a Mesh’s geometry and material slots as asset references', () => {
    // `Mesh<TGeometry, TMaterial>` declares them in terms of its own type parameters, so the
    // constraint is what says what may be authored. This is the pair `<Attachments>` used to
    // hold, and the reason a mesh can now just point at two asset files.
    const mesh = tags.get('Mesh')!;
    expect(mesh.parameters.map((p) => p.name)).toEqual(['geometry', 'material']);
    expect(mesh.parameters.map((p) => p.shape)).toEqual(['assetRef', 'assetRef']);
  });
});
