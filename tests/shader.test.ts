import { describe, expect, it } from 'vitest';
import { RawShaderMaterial, ShaderMaterial } from 'three';
import { Engine, deserializeBundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, parseUniforms, type ResourceResolver } from '@scenoco-three/compiler';

const VERT = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
  uniform vec3 uColor;      // base colour
  uniform float uTime;      // set per-frame at runtime
  uniform vec2 uScale;
  uniform sampler2D uMap;
  void main() { gl_FragColor = vec4(uColor, 1.0); }
`;
const resolve: ResourceResolver = (req) =>
  req === 'wave.vert' ? { path: req, contents: VERT } : req === 'wave.frag' ? { path: req, contents: FRAG } : null;

const scene = (uniforms: string, extra = '') => `<Scene>
  <Mesh id="m">
    <BoxGeometry />
    <ShaderMaterial vertex="wave.vert" fragment="wave.frag"${extra}>
      ${uniforms}
    </ShaderMaterial>
  </Mesh>
</Scene>`;

const compile = (xml: string) => compileSceneXml(xml, { path: 's.xml', resolve });
const shaderAsset = (s: ReturnType<typeof compile>) => (s.ok ? s.scene.attachments.find((a) => a.tag === 'ShaderMaterial')! : undefined);

describe('shader: GLSL uniform parsing', () => {
  it('extracts uniform name → type, ignoring precision qualifiers, arrays and comments', () => {
    const u = parseUniforms(`
      uniform highp vec3 uColor;
      uniform float uWeights[4];
      // uniform float uCommented;
      uniform sampler2D uMap;
    `);
    expect(u.get('uColor')).toBe('vec3');
    expect(u.get('uWeights')).toBe('float');
    expect(u.get('uMap')).toBe('sampler2D');
    expect(u.has('uCommented')).toBe(false);
  });
});

describe('shader: compile <ShaderMaterial> + <Uniform>', () => {
  it('inlines the shader source and collects validated uniforms', () => {
    const r = compile(scene(`
      <Uniform name="uColor" type="color" value="#ff8800" />
      <Uniform name="uScale" type="vec2" value="2 3" />
      <Uniform name="uMap" type="sampler2D" value="noise.png" />
    `));
    expect(r.ok).toBe(true);
    const asset = shaderAsset(r)!;
    expect(asset.attrs.fragment).toContain('uColor');
    expect(asset.attrs.vertex).toContain('gl_Position');
    expect(asset.uniforms).toEqual([
      { name: 'uColor', type: 'color', value: 0xff8800 },
      { name: 'uScale', type: 'vec2', value: [2, 3] },
      { name: 'uMap', type: 'sampler2D', value: 'noise.png' },
    ]);
  });

  it('allows a shader uniform that is not given an XML value (set at runtime)', () => {
    // uTime is declared in the shader but absent here — should be fine.
    expect(compile(scene(`<Uniform name="uColor" type="color" value="#fff" />`)).ok).toBe(true);
  });

  it('rejects a uniform not declared in the shader', () => {
    const r = compile(scene(`<Uniform name="uNope" type="float" value="1" />`));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.find((d) => d.code === 'bad-value')?.message).toContain('not declared');
  });

  it('rejects a uniform whose type does not match the shader declaration', () => {
    const r = compile(scene(`<Uniform name="uColor" type="vec4" value="1 0 0 1" />`));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msg = r.diagnostics.find((d) => d.code === 'bad-value')?.message ?? '';
      expect(msg).toContain('uColor');
      expect(msg).toContain('vec3');
    }
  });

  it('rejects an invalid uniform type', () => {
    const r = compile(scene(`<Uniform name="uColor" type="quaternion" value="0 0 0 1" />`));
    expect(r.ok).toBe(false);
  });
});

describe('shader: bundle round-trip + instantiation', () => {
  const r = compile(scene(`
    <Uniform name="uColor" type="color" value="#00ff00" />
    <Uniform name="uScale" type="vec2" value="2 3" />
    <Uniform name="uMap" type="sampler2D" value="noise.png" />
  `));

  it('preserves uniforms through the bundle (incl. a sampler2D path)', () => {
    if (!r.ok) throw new Error('compile failed');
    const back = deserializeBundle(bundleScene(r.scene));
    const asset = back.attachments.find((a) => a.tag === 'ShaderMaterial')!;
    expect(asset.uniforms).toEqual(r.scene.attachments.find((a) => a.tag === 'ShaderMaterial')!.uniforms);
    expect(asset.attrs.fragment).toContain('uColor'); // source survived
  });

  it('builds a ShaderMaterial with the right uniform values', () => {
    if (!r.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const mat = (engine.findObject('m') as unknown as { material: ShaderMaterial }).material;
    expect(mat).toBeInstanceOf(ShaderMaterial);
    expect((mat.uniforms.uColor!.value as { getHex(): number }).getHex()).toBe(0x00ff00);
    expect((mat.uniforms.uScale!.value as { toArray(): number[] }).toArray()).toEqual([2, 3]);
    expect(mat.vertexShader).toContain('gl_Position');
    engine.dispose();
  });

  it('raw="true" builds a RawShaderMaterial', () => {
    const raw = compile(scene(`<Uniform name="uColor" type="color" value="#fff" />`, ' raw="true"'));
    if (!raw.ok) throw new Error('compile failed');
    const engine = new Engine();
    engine.loadScene(bundleScene(raw.scene));
    expect((engine.findObject('m') as unknown as { material: unknown }).material).toBeInstanceOf(RawShaderMaterial);
    engine.dispose();
  });
});
