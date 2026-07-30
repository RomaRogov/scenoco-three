import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { resolveInEngine } from '../../packages/editor/app/session.js';

/**
 * `resolveInEngine` is the browser-side half of node addressing: the same `NodeRef`
 * the compiler's splicer resolves against the XML, resolved here against the live
 * scene. The two must agree — id first, structural path as the fallback — or an
 * edit targets one element in the viewport and a different one in the file.
 */
function engineWith(xml: string): Engine {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error(`fixture failed to compile: ${JSON.stringify(r.diagnostics)}`);
  const engine = new Engine({ editor: true });
  engine.loadScene(bundleScene(r.scene));
  return engine;
}

const SCENE = '<Scene><Group id="a"><Group id="kid" /></Group><Group id="b" /></Scene>';

describe('resolveInEngine', () => {
  it('resolves by id, and prefers id over a path that would point elsewhere', () => {
    const engine = engineWith(SCENE);
    expect(resolveInEngine(engine, { id: 'kid' })?.sceneId).toBe('kid');
    // `id` wins: the path here addresses #a, but the id must decide.
    expect(resolveInEngine(engine, { id: 'b', path: [0] })?.sceneId).toBe('b');
  });

  it('falls back to the structural path, counting only authored children', () => {
    const engine = engineWith(SCENE);
    expect(resolveInEngine(engine, { path: [0] })?.sceneId).toBe('a');
    expect(resolveInEngine(engine, { path: [1] })?.sceneId).toBe('b');
    expect(resolveInEngine(engine, { path: [0, 0] })?.sceneId).toBe('kid');
  });

  it('skips editor-only objects so gizmos never shift the ordinals', () => {
    const engine = engineWith(SCENE);
    // The editor adds its own helpers to the scene; they must not be counted, or
    // every path after them would address the wrong node.
    const gizmo = new Object3D();
    gizmo.userData.scenocoEditorOnly = true;
    engine.scene.add(gizmo);
    engine.scene.children.unshift(engine.scene.children.pop()!); // put it first

    expect(resolveInEngine(engine, { path: [0] })?.sceneId).toBe('a');
    expect(resolveInEngine(engine, { path: [1] })?.sceneId).toBe('b');
  });

  it('returns undefined for an unknown id, a stale path, or a ref with neither', () => {
    const engine = engineWith(SCENE);
    expect(resolveInEngine(engine, { id: 'ghost' })).toBeUndefined();
    expect(resolveInEngine(engine, { path: [7] })).toBeUndefined();
    expect(resolveInEngine(engine, {})).toBeUndefined();
  });

  it('treats an empty path as the scene root', () => {
    const engine = engineWith(SCENE);
    expect(resolveInEngine(engine, { path: [] })).toBe(engine.scene);
  });
});
