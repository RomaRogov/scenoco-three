import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A config written **inside** the component that uses it.
 *
 * A field typed by a document kind — `effect!: ParticleEffect` — has two forms, the same two a
 * material has: a path naming a file every user shares, or an element giving this one its own.
 * The element is named after the type, which is the rule every element in the DSL follows, so
 * nothing here is particular to particles: the vocabulary is read from the package's own type.
 */
let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('inline-config', { particles: true });
  fixture.write('tags.ts', "import '@scenoco-three/particles';\n");
  fixture.writeXml(
    'assets/vfx/shared.particle.xml',
    '<ParticleEffect duration="2" startSize="0.3" />',
  );
});
afterAll(() => fixture.dispose());

function compile(scene: string): { code: string; diagnostics: BuildResult['diagnostics'] } {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  const result = build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true });
  const entry = [...result.files].find(([path]) => path.endsWith('main.scene.gen.ts'));
  return { code: entry?.[1] ?? '', diagnostics: result.diagnostics };
}

const glow = (inner: string) =>
  `<Scene>
  <Group id="glow">
    <Components>
      ${inner}
    </Components>
  </Group>
</Scene>`;

describe('an effect written inside the component', () => {
  it('compiles to a typed value of the package’s own type', () => {
    const { code, diagnostics } = compile(
      glow(`<ParticleSystem>
        <ParticleEffect duration="3" looping="true" startSize="0.42">
          <Emission rateOverTime="20" />
        </ParticleEffect>
      </ParticleSystem>`),
    );
    expect(diagnostics).toEqual([]);
    // Annotated, so `tsc` checks the document's words against the package's type in the
    // generated file — the same guarantee a `.particle.xml` gets.
    expect(code).toContain('const effect: ParticleEffect = {');
    expect(code).toContain('emission: { rateOverTime: 20 }');
    expect(code).toContain('addComponent(ParticleSystem, { effect })');
    // The type travels as a type, never as a value: `ParticleEffect` is an interface, and an
    // ordinary import of one does not survive `verbatimModuleSyntax`.
    expect(code).toMatch(/import (type \{|\{ type )ParticleEffect/);
  });

  it('is this node’s own: two nodes writing the same thing get two values', () => {
    const { code, diagnostics } = compile(
      `<Scene>
  <Group><Components><ParticleSystem><ParticleEffect duration="1" /></ParticleSystem></Components></Group>
  <Group><Components><ParticleSystem><ParticleEffect duration="1" /></ParticleSystem></Components></Group>
</Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code.match(/const effect\S*: ParticleEffect/g)).toHaveLength(2);
  });

  it('still takes the shared form, which stays one import', () => {
    const { code, diagnostics } = compile(
      glow('<ParticleSystem effect="../vfx/shared.particle.xml" />'),
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('addComponent(ParticleSystem, { effect: shared })');
  });
});

describe('what the compiler refuses', () => {
  it('a file and an element for one field', () => {
    const { diagnostics } = compile(
      glow(`<ParticleSystem effect="../vfx/shared.particle.xml">
        <ParticleEffect duration="1" />
      </ParticleSystem>`),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['duplicate-value']);
    expect(diagnostics[0]!.message).toContain('name a file to share one');
  });

  it('two elements for one field', () => {
    const { diagnostics } = compile(
      glow(`<ParticleSystem>
        <ParticleEffect duration="1" />
        <ParticleEffect duration="2" />
      </ParticleSystem>`),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['duplicate-value']);
  });

  /**
   * The regression this whole pass exists for: a child of a component used to be read by
   * nobody. The components pass looked only at attributes and the node pass steps over
   * `<Components>`, so the document said something and the build said nothing.
   */
  it('a child that fills no field — which used to vanish in silence', () => {
    const { diagnostics } = compile(glow('<ParticleSystem><Emission rateOverTime="9" /></ParticleSystem>'));
    // And the emitter goes on to say the effect is still missing, which it is.
    expect(diagnostics.map((d) => d.code)).toEqual(['unknown-element', 'missing-attribute']);
    expect(diagnostics[0]!.message).toContain('<ParticleEffect>');
  });

  it('a child on a component that holds no elements at all', () => {
    fixture.write(
      'Spin.ts',
      `import { Component } from '@scenoco-three/core';\nexport class Spin extends Component { speed = 1; }\n`,
    );
    const { diagnostics } = compile(glow('<Spin><ParticleEffect duration="1" /></Spin>'));
    expect(diagnostics.map((d) => d.code)).toEqual(['unknown-element']);
    expect(diagnostics[0]!.message).toContain('only attributes');
    fixture.remove('src/Spin.ts');
  });
});
