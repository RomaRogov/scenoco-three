import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { patchSceneXml, type PatchEdit } from '@scenoco-three/compiler';
// Register the breakout component (Ball) + Box2D tags so component-prop edits
// resolve their attribute type from the registry, and the core node tags so
// structural-path locating can tell nodes from attachments.
import '@scenoco-three/box2d';
import '@scenoco-three/core/nodes';
import '../../examples/breakout/assets/components/Ball.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scene = readFileSync(resolve(root, 'examples/breakout/assets/scenes/breakout.scene.xml'), 'utf8');

/** Lines that differ between the original and the patched text. */
const changedLines = (before: string, after: string): string[] => {
  const a = before.split('\n');
  return after.split('\n').filter((line, i) => line !== a[i]);
};

describe('patchSceneXml — surgical, minimal-diff editing', () => {
  it('rewrites only the targeted attribute and leaves everything else intact', () => {
    const { text, changed, unresolved } = patchSceneXml(scene, [
      { target: { kind: 'node', id: 'ball' }, attr: 'position', value: [1, 2, 3] },
    ]);
    expect(changed).toBe(1);
    expect(unresolved).toEqual([]);
    expect(text).toMatch(/<Mesh id="ball" position="1 2 3">/);
    expect((text.match(/<PrefabInstance/g) ?? []).length).toBe(12); // structure untouched
    expect(changedLines(scene, text)).toHaveLength(1); // exactly one source line changed
  });

  it('removes an attribute when the value returns to the registry default', () => {
    const { text } = patchSceneXml(scene, [{ target: { kind: 'node', id: 'ball' }, attr: 'position', value: [0, 0, 0] }]);
    expect(text).toMatch(/<Mesh id="ball">/);
    expect(text).not.toMatch(/id="ball" position=/);
  });

  it('coalesces multiple edits to one element into a single rewritten start tag', () => {
    const { text, changed } = patchSceneXml(scene, [
      { target: { kind: 'node', id: 'paddle' }, attr: 'position', value: [1, 0.5, 0] },
      { target: { kind: 'node', id: 'paddle' }, attr: 'scale', value: [2, 1, 1] },
    ]);
    expect(changed).toBe(1);
    expect(text).toMatch(/id="paddle" position="1 0.5 0" scale="2 1 1"/);
  });

  it('locates an id-less node by structural path (ordinals among node-kind elements only)', () => {
    const xml = `<Scene>
  <PerspectiveCamera position="0 1 5" />
  <DirectionalLight intensity="2" />
  <Mesh>
    <BoxGeometry />
    <Components><Ball /></Components>
  </Mesh>
</Scene>`;
    const { text, changed, unresolved } = patchSceneXml(xml, [
      { target: { kind: 'node', path: [1], tag: 'DirectionalLight' }, attr: 'position', value: [0, 5, 0] },
    ]);
    expect(changed).toBe(1);
    expect(unresolved).toEqual([]);
    expect(text).toMatch(/<DirectionalLight intensity="2" position="0 5 0" \/>/);
    expect(changedLines(xml, text)).toHaveLength(1);
  });

  it('locates a component under an id-less node by nodePath (attachments do not shift ordinals)', () => {
    const xml = `<Scene>
  <PerspectiveCamera position="0 1 5" />
  <DirectionalLight intensity="2" />
  <Mesh>
    <BoxGeometry />
    <Components><Ball /></Components>
  </Mesh>
</Scene>`;
    // The Mesh is node-kind child #2 — <BoxGeometry> (an attachment) counts for nothing.
    const { text, changed } = patchSceneXml(xml, [
      { target: { kind: 'component', nodePath: [2], type: 'Ball', ordinal: 0 }, attr: 'launchSpeed', value: 20 },
    ]);
    expect(changed).toBe(1);
    expect(text).toMatch(/<Ball launchSpeed="20" \/>/);
  });

  it('treats a path whose element tag no longer matches as unresolved (stale file), leaving the text untouched', () => {
    const xml = `<Scene>
  <DirectionalLight intensity="2" />
</Scene>`;
    const edits: PatchEdit[] = [{ target: { kind: 'node', path: [0], tag: 'Mesh' }, attr: 'position', value: [1, 1, 1] }];
    const { text, changed, unresolved } = patchSceneXml(xml, edits);
    expect(changed).toBe(0);
    expect(unresolved).toEqual(edits);
    expect(text).toBe(xml);
  });

  it('edits a component property by node id + type + ordinal, and reports unlocatable targets', () => {
    const { text, changed } = patchSceneXml(scene, [
      { target: { kind: 'component', nodeId: 'ball', type: 'Ball', ordinal: 0 }, attr: 'launchSpeed', value: 20 },
    ]);
    expect(changed).toBe(1);
    expect(text).toMatch(/launchSpeed="20"/);

    const edits: PatchEdit[] = [{ target: { kind: 'node', id: 'does-not-exist' }, attr: 'position', value: [1, 1, 1] }];
    const miss = patchSceneXml(scene, edits);
    expect(miss.changed).toBe(0);
    expect(miss.unresolved).toEqual(edits);
  });
});
