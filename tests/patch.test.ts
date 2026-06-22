import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { patchSceneXml, type PatchEdit } from '@scenoco-three/compiler';
// Register the breakout component (Ball) + Box2D tags so component-prop edits
// can resolve their attribute type from the registry.
import '@scenoco-three/box2d';
import '../examples/breakout/components/Ball.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const scene = readFileSync(resolve(root, 'examples/breakout/scenes/breakout.scene.xml'), 'utf8');

/** Lines that differ between the original and the patched text. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  return b.filter((line, i) => line !== a[i]);
}

describe('patchSceneXml — surgical, minimal-diff editing', () => {
  it('rewrites only the targeted attribute and leaves everything else intact', () => {
    const { text, changed, unresolved } = patchSceneXml(scene, [
      { target: { kind: 'node', id: 'ball' }, attr: 'position', value: [1, 2, 3] },
    ]);
    expect(changed).toBe(1);
    expect(unresolved).toEqual([]);
    expect(text).toMatch(/<Mesh id="ball" position="1 2 3">/);
    // Untouched structure: all 12 prefab instances + comments survive.
    expect((text.match(/<PrefabInstance/g) ?? []).length).toBe(12);
    expect(text).toContain('Ball (dynamic bullet body');
    // Exactly one source line changed.
    expect(changedLines(scene, text)).toHaveLength(1);
  });

  it('removes an attribute when the value returns to the registry default', () => {
    const { text } = patchSceneXml(scene, [
      { target: { kind: 'node', id: 'ball' }, attr: 'position', value: [0, 0, 0] },
    ]);
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

  it('patches a self-closing PrefabInstance, preserving its alignment whitespace', () => {
    const { text, changed } = patchSceneXml(scene, [
      { target: { kind: 'node', id: 'b1' }, attr: 'position', value: [1, 1, 0] },
    ]);
    expect(changed).toBe(1);
    expect(text).toMatch(/id="b1"\s+position="1 1 0" \/>/);
  });

  it('edits a component property by node id + type + ordinal', () => {
    const { text, changed, unresolved } = patchSceneXml(scene, [
      { target: { kind: 'component', nodeId: 'ball', type: 'Ball', ordinal: 0 }, attr: 'launchSpeed', value: 20 },
    ]);
    expect(changed).toBe(1);
    expect(unresolved).toEqual([]);
    expect(text).toMatch(/launchSpeed="20"/);
  });

  it('reports edits whose target cannot be located', () => {
    const edits: PatchEdit[] = [{ target: { kind: 'node', id: 'does-not-exist' }, attr: 'position', value: [1, 1, 1] }];
    const { changed, unresolved } = patchSceneXml(scene, edits);
    expect(changed).toBe(0);
    expect(unresolved).toEqual(edits);
  });
});
