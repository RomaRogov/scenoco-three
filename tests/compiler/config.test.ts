import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  documentKinds,
  emitConfigDocument,
  parseDocument,
  scanConfigShape,
  shapeProblems,
  type ConfigShape,
  type SncDiagnostic,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A document kind declared by a package compiles to one typed config object, and its whole
 * vocabulary is read from the type the package named: **an element is the name of the type a
 * field holds, and its attributes are that type's fields.**
 *
 * The type read here is the **real** `ParticleEffect`, reached the way a project reaches it — the
 * kind comes from `@scenoco-three/particles`'s own `package.json`. That is the point of the
 * arrangement: the compiler holds no copy of the particle vocabulary, so if that package renames a
 * field or retypes one, this goes red rather than emitting a document that no longer typechecks.
 */
let fixture: Fixture;
let shape: ConfigShape;

beforeAll(() => {
  fixture = makeFixture('config', { particles: true });
  fixture.write(
    'game.ts',
    `import type { ParticleEffect } from '@scenoco-three/particles';\nexport type C = ParticleEffect;\n`,
  );

  const particle = documentKinds(fixture.dir).find((kind) => kind.kind === 'particle')!;
  shape = Workspace.with(fixture.tsconfig, (w) =>
    scanConfigShape(w, particle.package!.name, particle.type!),
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
    module: '@scenoco-three/particles',
  });
}

const codes = (d: SncDiagnostic[]) => d.map((x) => x.code);

describe('the config shape', () => {
  it('names the document and every element after the type that holds it', () => {
    expect(shape.name).toBe('ParticleEffect');
    expect([...shape.groups.values()].map((g) => g.name).sort()).toEqual([
      'ColorOverLifetime',
      'Emission',
      'Noise',
      'Renderer',
      'RotationOverLifetime',
      'Shape',
      'SizeOverLifetime',
    ]);
    // Nested one deeper, and a list rather than a group, because the field is an array.
    const emission = shape.groups.get('emission')!;
    expect([...emission.lists.values()].map((l) => l.name)).toEqual(['Burst']);
    expect(emission.lists.get('bursts')!.fields.map((f) => f.name)).toEqual(['count', 'time']);
  });

  it('derives each field’s authoring shape from its type', () => {
    const by = (n: string) => shape.fields.find((f) => f.name === n)!;
    expect(by('duration').shape).toBe('number');
    expect(by('looping').shape).toBe('boolean');
    // Declared `Color`, so the type says what the field is — and the emitted value is a real
    // `THREE.Color` rather than a hex number that only happens to work in some positions.
    expect(by('startColor').shape).toBe('color');
    expect(by('simulationSpace').shape).toBe('enum');
  });

  it('refuses an inline object type, which leaves no name for its element', () => {
    const anonymous: ConfigShape = {
      name: 'Thing',
      fields: [],
      groups: new Map(),
      lists: new Map(),
      problems: ['"trail" is written as an inline object type'],
    };
    expect(shapeProblems(anonymous)[0]).toContain('inline object type');
    // The real one has none, which is what makes the rule liveable.
    expect(shapeProblems(shape)).toEqual([]);
  });
});

describe('particle documents', () => {
  it('compiles the modules into one typed config', () => {
    const { code, diagnostics } = emit(
      `<ParticleEffect duration="3" looping="true" simulationSpace="World"
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
       </ParticleEffect>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain(`import type { ParticleEffect } from '@scenoco-three/particles';`);
    expect(code).toContain('export const fire: ParticleEffect = {');
    expect(code).toContain('startColor: new Color(0xffdd66),');
    expect(code).toContain(`simulationSpace: 'World',`);
    // `<Emission>` is the `emission` field, and `<Burst>` written twice is its `bursts` array.
    expect(code).toContain('rateOverTime: 90,');
    expect(code).toContain('bursts: [{ count: 10, time: 0 }, { count: 4, time: 1.5 }],');
    expect(code).toContain(`shape: { angle: 14, radius: 0.35, type: 'Cone' },`);
    expect(code).toContain('colors: [new Color(0xffee88), new Color(0xff6622), new Color(0x661100)],');
    expect(code).toContain('rotationOverLifetime: { angularVelocity: 40 },');
  });

  it('reports an element the type has no field for, offering the ones it has', () => {
    const { diagnostics } = emit('<ParticleEffect><Trails width="1" /></ParticleEffect>');
    expect(diagnostics[0]?.code).toBe('unknown-element');
    expect(diagnostics[0]?.message).toContain('<Emission>');
  });

  it('drops the alpha from a list colour rather than naming an opacity it does not have', () => {
    // `Write colors="#ff6600" opacity="0"` once sent a model to an attribute <ColorOverLifetime>
    // has no such thing as, and the next build failed on it.
    const { diagnostics } = emit('<ParticleEffect><ColorOverLifetime colors="[#ff660000]" /></ParticleEffect>');
    expect(diagnostics[0]?.message).not.toContain('opacity=');
    expect(diagnostics[0]?.message).toContain('Write #ff6600.');
  });

  it('fixes a list entry as the entry, keeping the list', () => {
    const { diagnostics } = emit('<ParticleEffect><ColorOverLifetime colors="[red, #ffffff]" /></ParticleEffect>');
    expect(diagnostics[0]?.message).toContain('Write #ff0000.');
    expect(diagnostics[0]?.message).not.toContain('write colors="#ff0000"');
  });

  it('shows a required list in its own spelling', () => {
    const { diagnostics } = emit('<ParticleEffect><SizeOverLifetime /></ParticleEffect>');
    expect(diagnostics[0]?.message).toContain('write it: curve="[1, 0.5, 0]"');
  });

  it('answers an attribute written as a child element with the attribute', () => {
    const { diagnostics } = emit('<ParticleEffect><SizeOverLifetime curve="[1, 0]"><Curve /></SizeOverLifetime></ParticleEffect>');
    expect(diagnostics[0]?.message).toContain('write curve="…" on <SizeOverLifetime>');
  });

  it('reports an element written twice where one value goes', () => {
    const { diagnostics } = emit('<ParticleEffect><Shape radius="1" /><Shape radius="2" /></ParticleEffect>');
    expect(codes(diagnostics)).toContain('duplicate-element');
  });

  it('reports an attribute the type does not declare, with a suggestion', () => {
    const { diagnostics } = emit('<ParticleEffect startLifetim="2" />');
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    expect(diagnostics[0]?.message).toContain('Did you mean "startLifetime"?');
  });

  it('reports a field the type requires, rather than leaving it to tsc on generated code', () => {
    const { diagnostics } = emit('<ParticleEffect><Emission><Burst count="20" /></Emission></ParticleEffect>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('missing-attribute');
    expect(diagnostics[0]?.message).toContain('<Burst> requires "time"');
  });

  it('hands a list written without brackets back with them', () => {
    const { diagnostics } = emit('<ParticleEffect><ColorOverLifetime colors="#ff0000, #00ff00" /></ParticleEffect>');
    expect(diagnostics[0]?.message).toContain('Write colors="[#ff0000, #00ff00]"');
  });

  it('offers no bracketed rewrite that would fail again, and says what an entry is instead', () => {
    const { diagnostics } = emit('<ParticleEffect><SizeOverLifetime curve="0 1, 1 0" /></ParticleEffect>');
    expect(diagnostics[0]?.message).not.toContain('Write curve=');
    expect(diagnostics[0]?.message).toContain('each entry a number, as curve="[1, 0.5, 0]"');
  });

  it('reports a value of the wrong type', () => {
    const { diagnostics } = emit('<ParticleEffect looping="yes" />');
    expect(codes(diagnostics)).toContain('bad-boolean');
  });

  it('reports a document rooted at the wrong element', () => {
    const { diagnostics } = emit('<Emitter />');
    expect(diagnostics[0]?.code).toBe('bad-root');
  });
});
