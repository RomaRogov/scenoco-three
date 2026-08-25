import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PARTICLE_CONFIG,
  PARTICLE_MODULES,
  Workspace,
  emitConfigDocument,
  parseDocument,
  scanConfigShape,
  type ConfigShape,
  type SncDiagnostic,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A `.particle.xml` is written in Unity's Shuriken vocabulary and compiles to one typed
 * config object. The module *names* come from a table (Unity's names and the config's field
 * names are two conventions, and no type relates them); everything else — which attributes
 * exist, what they accept — is read from the config interface itself.
 *
 * The interface read here is the **real** `ParticleConfig`, from `@scenoco-three/particles`.
 * That is the whole point of the arrangement: the compiler holds no copy of the particle
 * vocabulary, so if that package renames a field or retypes one, this goes red rather than
 * emitting a document that no longer typechecks.
 */
let fixture: Fixture;
let shape: ConfigShape;

beforeAll(() => {
  fixture = makeFixture('config', { particles: true });
  fixture.write(
    'game.ts',
    `import type { ParticleConfig } from '@scenoco-three/particles';\nexport type C = ParticleConfig;\n`,
  );

  shape = Workspace.with(fixture.tsconfig, (w) =>
    scanConfigShape(w, PARTICLE_CONFIG.module, PARTICLE_CONFIG.name),
  )!;
});

afterAll(() => fixture.dispose());

function emit(xml: string, name = 'fire') {
  const parsed = parseDocument(xml, `${name}.particle.xml`);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
  return emitConfigDocument(parsed.root, {
    name,
    source: `${name}.particle.xml`,
    shape,
    type: PARTICLE_CONFIG,
    rootTag: PARTICLE_CONFIG.rootTag,
    bindings: PARTICLE_MODULES,
  });
}

const codes = (d: SncDiagnostic[]) => d.map((x) => x.code);

describe('the config shape', () => {
  it('reads flat fields, groups and lists out of the interface', () => {
    expect(shape.fields.map((f) => f.name)).toContain('startLifetime');
    expect([...shape.groups.keys()].sort()).toEqual(['noise', 'renderer', 'shape']);
    expect([...shape.lists.keys()]).toEqual(['bursts']);
    expect(shape.lists.get('bursts')!.fields.map((f) => f.name)).toEqual(['count', 'time']);
  });

  it('derives each field’s authoring shape from its type', () => {
    const by = (n: string) => shape.fields.find((f) => f.name === n)!;
    expect(by('duration').shape).toBe('number');
    expect(by('looping').shape).toBe('boolean');
    // Declared `Color`, so the type says what the field is — and the emitted value is a real
    // `THREE.Color` rather than a hex number that only happens to work in some positions.
    expect(by('startColor').shape).toBe('color');
    expect(by('simulationSpace').shape).toBe('enum');
    expect(by('colorOverLifetime').shape).toBe('array');
  });
});

describe('particle documents', () => {
  it('compiles the Shuriken modules into one typed config', () => {
    const { code, diagnostics } = emit(
      `<ParticleSystem duration="3" looping="true" simulationSpace="World"
                       startLifetime="1.6" startSpeed="4.5" startColor="#ffdd66" gravityModifier="-0.15">
         <Emission rateOverTime="90">
           <Burst time="0" count="10" />
           <Burst time="1.5" count="4" />
         </Emission>
         <Shape type="Cone" radius="0.35" angle="14" />
         <Renderer renderMode="Billboard" blending="Additive" />
         <ColorOverLifetime colors="[#ffee88, #ff6622, #661100]" />
         <SizeOverLifetime curve="[0.4, 1, 0.2]" />
         <RotationOverLifetime angularVelocity="40" />
         <Noise strength="0.4" frequency="1.5" />
       </ParticleSystem>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain(`import { ParticleConfig } from '@scenoco-three/particles';`);
    expect(code).toContain('export const fire: ParticleConfig = {');
    expect(code).toContain('startColor: new Color(0xffdd66),');
    expect(code).toContain(`simulationSpace: 'World',`);
    // `<Emission rateOverTime>` merges into the root; `<Burst>` appends to `bursts`.
    expect(code).toContain('rateOverTime: 90,');
    expect(code).toContain('bursts: [{ count: 10, time: 0 }, { count: 4, time: 1.5 }],');
    // `<Shape>` nests.
    expect(code).toContain('shape: {');
    expect(code).toContain(`type: 'Cone',`);
    // A one-attribute module writes the field directly.
    expect(code).toContain(
      'colorOverLifetime: [new Color(0xffee88), new Color(0xff6622), new Color(0x661100)],',
    );
    expect(code).toContain('rotationOverLifetime: 40,');
  });

  it('reports a module the config has no field for', () => {
    const { diagnostics } = emit('<ParticleSystem><Trails width="1" /></ParticleSystem>');
    expect(codes(diagnostics)).toContain('unknown-module');
  });

  it('reports an attribute the interface does not declare, with a suggestion', () => {
    const { diagnostics } = emit('<ParticleSystem startLifetim="2" />');
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    expect(diagnostics[0]?.message).toContain('Did you mean "startLifetime"?');
  });

  it('reports a value of the wrong type', () => {
    const { diagnostics } = emit('<ParticleSystem looping="yes" />');
    expect(codes(diagnostics)).toContain('bad-boolean');
  });

  it('reports a document rooted at the wrong element', () => {
    const { diagnostics } = emit('<Emitter />');
    expect(diagnostics[0]?.code).toBe('bad-root');
  });
});
