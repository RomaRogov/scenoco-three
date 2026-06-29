import { describe, expect, it } from 'vitest';
import { compileSceneXml, type ResourceResolver } from '@scenoco-three/compiler';

// A 2-node prefab (so it has both a root and an internal node) + a src material.
const PREFAB = `<Prefab>
  <Group id="root">
    <Mesh id="inner"><BoxGeometry /><MeshStandardMaterial color="#ff0000" /></Mesh>
  </Group>
</Prefab>`;
const MATERIAL = `<MeshStandardMaterial color="#00ff00" roughness="0.4" />`;
const resolve: ResourceResolver = (req) =>
  req === 'thing.prefab.xml' ? { path: req, contents: PREFAB } : req === 'steel.material.xml' ? { path: req, contents: MATERIAL } : null;

const SCENE = `<Scene>
  <PrefabInstance src="thing.prefab.xml" id="t1" position="1 0 0" />
  <Mesh id="solo"><BoxGeometry /><MeshStandardMaterial src="steel.material.xml" /></Mesh>
</Scene>`;

describe('compiler provenance', () => {
  it('classifies node origins: prefab root, prefab internal, authored scene', () => {
    const r = compileSceneXml(SCENE, { path: 'scene.xml', resolve });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const originOf = (id: string) => r.provenance.nodes[r.scene.nodes.findIndex((n) => n.id === id)];

    expect(originOf('t1')).toEqual({ kind: 'prefab-root', src: 'thing.prefab.xml' });
    expect(originOf('t1/inner')).toEqual({ kind: 'prefab-internal' });
    expect(originOf('solo')).toEqual({ kind: 'scene' });
  });

  it('records the src= a material was loaded from (inline attachments are null)', () => {
    const r = compileSceneXml(SCENE, { path: 'scene.xml', resolve });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provenance.attachments).toContain('steel.material.xml');
    // Geometries + the prefab's inline material carry no src.
    expect(r.provenance.attachments).toContain(null);
  });
});
