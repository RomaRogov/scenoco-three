import { RawShaderMaterial, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, deserializeBundle } from '@scenoco-three/core';
import { bundleScene, compileSceneXml, parseUniforms, type ResourceResolver } from '@scenoco-three/compiler';

function memoryResolver(files: Record<string, string>): ResourceResolver {
  return (request) => (request in files ? { path: request, contents: files[request]! } : null);
}
const steel = '<MeshStandardMaterial color="#8a8f99" roughness="0.3" metalness="0.85" />';
type Asset = { tag: string; attrs: Record<string, unknown> };
const materials = (scene: { attachments: Asset[] }): Asset[] => scene.attachments.filter((a) => a.tag === 'MeshStandardMaterial');

describe('material src= resources', () => {
  it('pulls material attributes from a resource file, with inline attributes overriding it', () => {
    const r = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" roughness="0.05" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'steel.material.xml': steel }) },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(materials(r.scene)[0]!.attrs.color).toBe(0x8a8f99); // from file
    expect(materials(r.scene)[0]!.attrs.metalness).toBe(0.85); // from file
    expect(materials(r.scene)[0]!.attrs.roughness).toBe(0.05); // inline override
  });

  it('shares (dedups) identical materials across meshes', () => {
    const r = compileSceneXml(
      `<Scene><Mesh id="A"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh>
        <Mesh id="B"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'steel.material.xml': steel }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(materials(r.scene)).toHaveLength(1); // one shared pooled material
  });

  it('reports resource diagnostics: not-found, tag-mismatch, and src without a resolver', () => {
    const missing = compileSceneXml(`<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="ghost.material.xml" /></Mesh></Scene>`, {
      resolve: memoryResolver({}),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0]!.code).toBe('resource-not-found');

    const mismatch = compileSceneXml(`<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="x.xml" /></Mesh></Scene>`, {
      resolve: memoryResolver({ 'x.xml': '<MeshBasicMaterial color="#fff" />' }),
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.diagnostics[0]!.code).toBe('resource-tag-mismatch');

    const noResolver = compileSceneXml(`<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh></Scene>`);
    expect(noResolver.ok).toBe(false);
    if (!noResolver.ok) expect(noResolver.diagnostics[0]!.code).toBe('no-resolver');
  });
});

const VERT = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform vec3 uColor; uniform float uTime; uniform vec2 uScale; uniform sampler2D uMap;
  void main() { gl_FragColor = vec4(uColor, 1.0); }`;
const shaderResolve: ResourceResolver = (req) =>
  req === 'wave.vert' ? { path: req, contents: VERT } : req === 'wave.frag' ? { path: req, contents: FRAG } : null;
const shaderScene = (uniforms: string, extra = '') =>
  `<Scene><Mesh id="m"><BoxGeometry /><ShaderMaterial vertex="wave.vert" fragment="wave.frag"${extra}>${uniforms}</ShaderMaterial></Mesh></Scene>`;
const compileShader = (xml: string) => compileSceneXml(xml, { path: 's.xml', resolve: shaderResolve });

describe('shader materials', () => {
  it('parses GLSL uniforms and collects/validates <Uniform> values against the shader declarations', () => {
    const parsed = parseUniforms(`uniform highp vec3 uColor; uniform float uWeights[4]; // uniform float uCommented;\nuniform sampler2D uMap;`);
    expect(parsed.get('uColor')).toBe('vec3');
    expect(parsed.get('uWeights')).toBe('float'); // arrays reduced to element type
    expect(parsed.has('uCommented')).toBe(false); // comments ignored

    const good = compileShader(shaderScene(`<Uniform name="uColor" type="color" value="#ff8800" /><Uniform name="uScale" type="vec2" value="2 3" />`));
    expect(good.ok).toBe(true);
    // A uniform not declared in the shader, or with a mismatched type, is rejected.
    expect(compileShader(shaderScene(`<Uniform name="uNope" type="float" value="1" />`)).ok).toBe(false);
    expect(compileShader(shaderScene(`<Uniform name="uColor" type="vec4" value="1 0 0 1" />`)).ok).toBe(false);
  });

  it('round-trips uniforms through the bundle and builds a (Raw)ShaderMaterial with the right values', () => {
    const r = compileShader(shaderScene(`<Uniform name="uColor" type="color" value="#00ff00" /><Uniform name="uMap" type="sampler2D" value="noise.png" />`));
    if (!r.ok) throw new Error('compile failed');
    const back = deserializeBundle(bundleScene(r.scene));
    expect(back.attachments.find((a) => a.tag === 'ShaderMaterial')!.uniforms).toEqual(
      r.scene.attachments.find((a) => a.tag === 'ShaderMaterial')!.uniforms,
    );

    const engine = new Engine();
    engine.loadScene(bundleScene(r.scene));
    const mat = (engine.findObject('m') as unknown as { material: ShaderMaterial }).material;
    expect(mat).toBeInstanceOf(ShaderMaterial);
    expect((mat.uniforms.uColor!.value as { getHex(): number }).getHex()).toBe(0x00ff00);
    engine.dispose();

    const raw = compileShader(shaderScene(`<Uniform name="uColor" type="color" value="#fff" />`, ' raw="true"'));
    if (!raw.ok) throw new Error('compile failed');
    const rawEngine = new Engine();
    rawEngine.loadScene(bundleScene(raw.scene));
    expect((rawEngine.findObject('m') as unknown as { material: unknown }).material).toBeInstanceOf(RawShaderMaterial);
    rawEngine.dispose();
  });
});
