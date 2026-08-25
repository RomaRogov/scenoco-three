import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  emitRender,
  parseDocument,
  scanComponents,
  scanEffects,
  scanSystems,
  scanTags,
  type AssetImport,
  type ProjectModel,
  type SncDiagnostic,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The render document: how a scene is drawn.
 *
 * The claim under test is the one that made it a document at all — that everything deciding how
 * a frame looks is written the same way, as an element that is either there or not, with no
 * value that means "off" and nothing masquerading as a `THREE.Scene` property.
 */
let fixture: Fixture;
let model: ProjectModel;

const ASSETS: Record<string, AssetImport> = {};

beforeAll(() => {
  fixture = makeFixture('render');
  fixture.write(
    'effects.ts',
    `import { Effect } from '@scenoco-three/core';
import { ACESFilmicToneMapping, type ToneMapping as Curve, type WebGLRenderer } from 'three';

/** The tone curve applied to the rendered image. */
export class ToneMapping extends Effect {
  curve: Curve = ACESFilmicToneMapping;
  exposure = 1;
  override apply({ renderer }: { renderer: WebGLRenderer }) {
    renderer.toneMapping = this.curve;
  }
}

export class Bloom extends Effect {
  strength = 0.6;
  threshold = 0.85;
}
`,
  );
  model = Workspace.with(fixture.tsconfig, (w) => ({
    components: scanComponents(w),
    systems: scanSystems(w),
    effects: scanEffects(w),
    tags: scanTags(w),
  }));
});

afterAll(() => fixture.dispose());

function emit(xml: string, name = 'neon') {
  const source = `${name}.render.xml`;
  const parsed = parseDocument(xml, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
  return emitRender(parsed.root, { name, model, source, resolveAsset: (href) => ASSETS[href] });
}

const codes = (diagnostics: SncDiagnostic[]) => diagnostics.map((d) => d.code);

describe('a render document', () => {
  it('is a list of things that decide how a frame looks, each on because it is written', () => {
    const { code, diagnostics } = emit(
      `<Render>
         <Fog color="#05070d" near="20" far="46" />
         <ToneMapping curve="ACESFilmicToneMapping" exposure="1.05" />
         <Bloom strength="0.75" threshold="0.72" />
       </Render>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('const fog = new Fog(new Color(0x05070d), 20, 46);');
    expect(code).toContain('const toneMapping = new ToneMapping();');
    expect(code).toContain('toneMapping.curve = ACESFilmicToneMapping;');
    expect(code).toContain('toneMapping.exposure = 1.05;');
    expect(code).toContain('bloom.strength = 0.75;');
    expect(code).toContain('export const neon = new RenderSettings([toneMapping, bloom], fog);');
  });

  it('is empty when it says nothing, which is a scene with three.js defaults', () => {
    const { code, diagnostics } = emit(`<Render />`);
    expect(diagnostics).toEqual([]);
    expect(code).toContain('export const neon = new RenderSettings([]);');
  });

  it('checks an effect the same way a component is checked', () => {
    expect(codes(emit(`<Render><Bloom strenght="0.75" /></Render>`).diagnostics)).toEqual([
      'unknown-attribute',
    ]);
    expect(codes(emit(`<Render><Bloom strength="lots" /></Render>`).diagnostics)).toEqual([
      'bad-number',
    ]);
  });

  it('names the package an unknown effect would come from', () => {
    const { diagnostics } = emit(`<Render><Glow strength="1" /></Render>`);
    expect(codes(diagnostics)).toEqual(['unknown-effect']);
    expect(diagnostics[0]!.message).toContain('postfx');
  });

  it('takes no attributes of its own, and one fog', () => {
    expect(codes(emit(`<Render bloom="0.5" />`).diagnostics)).toEqual(['unknown-attribute']);
    expect(
      codes(emit(`<Render><Fog color="#000" /><Fog color="#fff" /></Render>`).diagnostics),
    ).toEqual(['duplicate-fog']);
  });

  it('must be rooted at <Render>', () => {
    expect(codes(emit(`<Bloom strength="1" />`).diagnostics)).toEqual(['bad-root']);
  });
});
