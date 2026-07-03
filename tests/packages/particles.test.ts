import { describe, expect, it } from 'vitest';
import '@scenoco-three/particles'; // registers <ParticleSystem> + its .particle.xml src-compiler
import { bundleScene, compileSceneXml, generateXsd, type ResourceResolver } from '@scenoco-three/compiler';
import { deserializeBundle } from '@scenoco-three/core';

const FIRE = `<ParticleSystem duration="2" simulationSpace="World" startColor="#ff8800">
  <Emission rateOverTime="50"><Burst time="0" count="5" /></Emission>
  <Shape type="Sphere" radius="0.5" />
  <ColorOverLifetime colors="[#ffee88, #661100]" />
  <SizeOverLifetime curve="[1, 0]" />
</ParticleSystem>`;

const SCENE = `<Scene><Group><Components><ParticleSystem src="fire.particle.xml" /></Components></Group></Scene>`;

describe('particles src document', () => {
  // The whole seam end to end: a component's `src=` document is resolved, handed
  // to the package's registered compiler, and the config blob rides the bundle.
  it('compiles <ParticleSystem src> to a config blob that survives the bundle', () => {
    const resolve: ResourceResolver = (req) =>
      req.endsWith('.particle.xml') ? { path: '/vfx/fire.particle.xml', contents: FIRE } : null;
    const result = compileSceneXml(SCENE, { path: '/scene.xml', resolve });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));

    const config = result.scene.components.find((c) => c.type === 'ParticleSystem')!.config;
    expect(config).toEqual({
      duration: 2,
      simulationSpace: 'World',
      startColor: 0xff8800,
      rateOverTime: 50,
      bursts: [{ time: 0, count: 5 }],
      shape: { type: 'Sphere', radius: 0.5 },
      colorOverLifetime: [0xffee88, 0x661100],
      sizeOverLifetime: [1, 0],
    });

    // Opaque blob round-trips through the bundle unchanged.
    const restored = deserializeBundle(JSON.parse(JSON.stringify(bundleScene(result.scene))) as ReturnType<typeof bundleScene>);
    expect(restored.components.find((c) => c.type === 'ParticleSystem')!.config).toEqual(config);
  });

  // The XSD must let a src-document component carry `src=` (the seam's attribute,
  // not a @property) so a scene that uses `<ParticleSystem src>` validates in an IDE.
  it('gives <ParticleSystem> a src attribute in the exported scene XSD', () => {
    const element = generateXsd().split('<xs:element name="ParticleSystem">')[1]!.split('</xs:element>')[0]!;
    expect(element).toMatch(/<xs:attribute name="src" type="xs:string"/);
  });

  // A missing src-compiler / unresolved file must fail with a clear diagnostic.
  it('reports a src that cannot be resolved', () => {
    const result = compileSceneXml(SCENE, { path: '/scene.xml', resolve: () => null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((d) => /resolve src=/.test(d.message))).toBe(true);
  });
});
