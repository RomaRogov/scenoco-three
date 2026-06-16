import { describe, expect, it } from 'vitest';
import { compileSceneXml, type ResourceResolver } from '@scenoco-three/compiler';

// An in-memory resolver — the browser-host equivalent of the CLI's filesystem one.
function memoryResolver(files: Record<string, string>): ResourceResolver {
  return (request) => (request in files ? { path: request, contents: files[request]! } : null);
}

const steel = '<MeshStandardMaterial color="#8a8f99" roughness="0.3" metalness="0.85" />';

// Material is now an attachment in the shared pool; these helpers find it.
type Asset = { tag: string; attrs: Record<string, unknown> };
const materials = (scene: { attachments: Asset[] }): Asset[] =>
  scene.attachments.filter((a) => a.tag === 'MeshStandardMaterial');
const matIndexOf = (node: { attachments: number[] }, scene: { attachments: Asset[] }): number =>
  node.attachments.find((i) => scene.attachments[i]!.tag === 'MeshStandardMaterial')!;

describe('material src= resources', () => {
  it('pulls material attributes from a resource file', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'steel.material.xml': steel }) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mat = materials(result.scene)[0]!;
      expect(mat.attrs.color).toBe(0x8a8f99);
      expect(mat.attrs.roughness).toBe(0.3);
      expect(mat.attrs.metalness).toBe(0.85);
    }
  });

  it('lets inline attributes override the resource file', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" roughness="0.05" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'steel.material.xml': steel }) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(materials(result.scene)[0]!.attrs.roughness).toBe(0.05); // overridden
      expect(materials(result.scene)[0]!.attrs.metalness).toBe(0.85); // from file
    }
  });

  it('shares (dedups) identical materials across meshes', () => {
    const result = compileSceneXml(
      `<Scene>
        <Mesh id="A"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh>
        <Mesh id="B"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh>
      </Scene>`,
      { resolve: memoryResolver({ 'steel.material.xml': steel }) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(materials(result.scene)).toHaveLength(1); // one shared material
      const [a, b] = result.scene.nodes.filter((n) => n.tag === 'Mesh');
      expect(matIndexOf(a!, result.scene)).toBe(matIndexOf(b!, result.scene));
    }
  });

  it('dedups identical inline materials too', () => {
    const result = compileSceneXml(`<Scene>
      <Mesh id="A"><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Mesh>
      <Mesh id="B"><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Mesh>
    </Scene>`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(materials(result.scene)).toHaveLength(1);
  });

  it('reports a missing resource against the scene', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="ghost.material.xml" /></Mesh></Scene>`,
      { resolve: memoryResolver({}) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.code).toBe('resource-not-found');
  });

  it('reports a tag mismatch (file defines a different element)', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="x.xml" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'x.xml': '<MeshBasicMaterial color="#fff" />' }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.code).toBe('resource-tag-mismatch');
  });

  it('reports a bad value in the resource file against that file', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="bad.material.xml" /></Mesh></Scene>`,
      { resolve: memoryResolver({ 'bad.material.xml': '<MeshStandardMaterial roughness="huge" />' }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const d = result.diagnostics[0]!;
      expect(d.code).toBe('bad-value');
      expect(d.file).toBe('bad.material.xml');
    }
  });

  it('errors when src is used without a resolver', () => {
    const result = compileSceneXml(
      `<Scene><Mesh id="M"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh></Scene>`,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.code).toBe('no-resolver');
  });
});
