import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attachmentTags, nodeTags } from '@scenoco-three/core';
import { builtinNodeModule, builtinNodeModules, compileSceneXml } from '@scenoco-three/compiler';

/**
 * Tree-shaking contract: the runtime entry (`@scenoco-three/core`) ships zero
 * node modules; built-ins register on demand. The Vite plugin emits a
 * usage-based import per used tag via this manifest, so unused node tags (and
 * their three classes) never reach the bundle. These tests guard the manifest
 * against drift and verify the usage selection.
 */
describe('built-in node manifest (tree-shaking)', () => {
  it('lists exactly the registered built-in tags (no drift vs nodes/index.ts)', () => {
    // tests/setup.ts imports the barrel, so every built-in is registered here.
    const registered = new Set([...nodeTags(), ...attachmentTags()]);
    const listed = new Set(Object.keys(builtinNodeModules));
    expect(listed).toEqual(registered);
  });

  it('maps every tag to an existing module file', () => {
    for (const [tag, specifier] of Object.entries(builtinNodeModules)) {
      expect(specifier.startsWith('@scenoco-three/core/nodes/')).toBe(true);
      const rel = specifier.replace('@scenoco-three/core/nodes/', '').replace(/\.js$/, '.ts');
      const path = fileURLToPath(new URL(`../packages/core/src/nodes/${rel}`, import.meta.url));
      expect(existsSync(path), `${tag} → ${path}`).toBe(true);
    }
  });
});

describe('usage-based built-in selection (what the Vite plugin ships)', () => {
  /** Mirror the plugin: collect the built-in module specifiers a scene needs. */
  function builtinsFor(xml: string): Set<string> {
    const r = compileSceneXml(xml);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    const specs = new Set<string>();
    const add = (tag: string) => {
      const s = builtinNodeModule(tag);
      if (s) specs.add(s);
    };
    for (const n of r.scene.nodes) add(n.tag);
    for (const a of r.scene.attachments) add(a.tag);
    return specs;
  }

  it('ships only the tags a scene uses, not the rest of the palette', () => {
    const specs = builtinsFor(`<Scene>
      <Fog />
      <Mesh id="m"><BoxGeometry /><MeshStandardMaterial /></Mesh>
      <SpotLight id="s" />
    </Scene>`);
    // Present: exactly the used tags.
    expect(specs).toContain(builtinNodeModule('Scene'));
    expect(specs).toContain(builtinNodeModule('Mesh'));
    expect(specs).toContain(builtinNodeModule('BoxGeometry'));
    expect(specs).toContain(builtinNodeModule('MeshStandardMaterial'));
    expect(specs).toContain(builtinNodeModule('SpotLight'));
    expect(specs).toContain(builtinNodeModule('Fog'));
    // Absent: everything unused stays out of the bundle.
    for (const tag of ['BatchedMesh', 'SkinnedMesh', 'TorusGeometry', 'PointsMaterial', 'FogExp2', 'OrthographicCamera']) {
      expect(specs).not.toContain(builtinNodeModule(tag));
    }
  });
});
