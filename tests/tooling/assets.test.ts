import { describe, expect, it } from 'vitest';
import {
  assetKinds,
  assetKindOf,
  materialFile,
  prefabFile,
  sceneFile,
  systemFile,
  validateAssetXml,
  registerSrcDocument,
} from '@scenoco-three/compiler';
import { srcDocument } from '@scenoco-three/particles/compiler';
import '@scenoco-three/particles'; // registers the <ParticleSystem> component

// `scenoco` does this through registerPackages; a test does it by hand. Without
// it there is no package-owned format registered and the `.particle.xml` cases
// below would be testing the "unknown kind" path instead.
registerSrcDocument(srcDocument);

describe('asset kinds', () => {
  // Every document a project can hold must be creatable and checkable. The
  // built-ins are fixed; package-owned formats arrive through the registry, so
  // adding one never means editing the CLI.
  it('covers every document kind, built-in and package-owned', () => {
    expect(assetKinds().map((k) => k.kind)).toEqual(['scene', 'prefab', 'material', 'particle']);
  });

  it('maps a path to its kind by extension', () => {
    expect(assetKindOf('assets/scenes/a.scene.xml')?.kind).toBe('scene');
    expect(assetKindOf('assets/scenes/a.prefab.xml')?.kind).toBe('prefab');
    expect(assetKindOf('assets/materials/a.material.xml')?.kind).toBe('material');
    expect(assetKindOf('assets/vfx/a.particle.xml')?.kind).toBe('particle');
    expect(assetKindOf('assets/a.txt')).toBeUndefined();
  });

  it('names the kinds it accepts when given something else', () => {
    const r = validateAssetXml('notes.txt', '<Scene />');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.message).toContain('.particle.xml');
  });
});

describe('validateAssetXml', () => {
  it('checks a scene and a prefab by compiling them', () => {
    expect(validateAssetXml('a.scene.xml', sceneFile('a')).ok).toBe(true);
    expect(validateAssetXml('a.prefab.xml', prefabFile('a')).ok).toBe(true);

    const bad = validateAssetXml('a.scene.xml', `<Scene><Mesh id="m" position="q: 1" /></Scene>`);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => /unknown axis "q"/.test(d.message))).toBe(true);
  });

  // A `.material.xml` has no host node, so the checks are what a shared file can
  // be judged on alone: it holds a material, and its attributes are well-typed.
  it('checks a standalone material document', () => {
    expect(validateAssetXml('m.material.xml', materialFile('m')).ok).toBe(true);

    const typo = validateAssetXml('m.material.xml', `<MeshStandardMaterial roughnes="0.4" />`);
    expect(typo.ok).toBe(false);
    expect(typo.diagnostics[0]!.message).toContain('Did you mean "roughness"?');

    // A geometry is an attachment, but not a material — the group is the point.
    const wrong = validateAssetXml('m.material.xml', `<BoxGeometry width="1" />`);
    expect(wrong.ok).toBe(false);
    expect(wrong.diagnostics[0]!.message).toMatch(/is a geometry, not a material/);
  });

  // The payoff of routing package formats through the CLI: the format's own
  // semantic diagnostics, which an XSD can never produce.
  it('delegates a package-owned document to the format that owns it', () => {
    expect(validateAssetXml('v.particle.xml', srcDocument.template('v')).ok).toBe(true);

    const badColor = validateAssetXml('v.particle.xml', `<ParticleSystem startColor="notacolor" />`);
    expect(badColor.ok).toBe(false);
    expect(badColor.diagnostics[0]!.code).toBe('particle-bad-color');

    const badRoot = validateAssetXml('v.particle.xml', `<Emission rateOverTime="5" />`);
    expect(badRoot.ok).toBe(false);
    expect(badRoot.diagnostics[0]!.message).toMatch(/root must be <ParticleSystem>, got <Emission>/);
  });
});

describe('scenoco new templates', () => {
  // A generated file that does not validate is worse than no generator: it
  // teaches a broken shape and costs a debugging session on step one.
  it('emits documents that pass their own validator', () => {
    expect(validateAssetXml('a.scene.xml', sceneFile('a')).ok).toBe(true);
    expect(validateAssetXml('a.prefab.xml', prefabFile('a')).ok).toBe(true);
    expect(validateAssetXml('a.material.xml', materialFile('a')).ok).toBe(true);
    expect(validateAssetXml('a.particle.xml', srcDocument.template('a')).ok).toBe(true);
  });

  // No generated document points at an XSD. The toolchain answers "what may I
  // write here" (`scenoco validate` / `scenoco which`); a schema pointer in every
  // file sends readers into the XSD instead — and machine-readable schema
  // artifacts are the one place a small model reliably gets lost. `scenoco
  // export` still emits them, for IDE completion, opt-in.
  it('emits documents with no schema pointer', () => {
    for (const doc of [sceneFile('a'), prefabFile('a'), materialFile('a'), srcDocument.template('a')]) {
      expect(doc).not.toMatch(/noNamespaceSchemaLocation|xmlns:xsi/);
    }
  });

  // The vector grammar has one rule — an omitted axis is 0 — and the templates
  // are most people's first sight of it, so they must be written in it.
  it('writes transforms in the keyed vector form', () => {
    expect(sceneFile('a')).toMatch(/position="y: 1; z: 5"/);
    expect(sceneFile('a')).not.toMatch(/position="[-\d. ]+"/);
  });

  // A @system(T) is meaningless without its component type, so the template
  // derives one from the name; the CLI tells you when it does not exist yet.
  it('derives a system template from the component it processes', () => {
    const src = systemFile('SpawnerSystem');
    expect(src).toMatch(/@system\(Spawner\)/);
    expect(src).toMatch(/extends System<Spawner>/);
    expect(src).toMatch(/from '\.\.\/components\/Spawner\.js'/);
  });
});
