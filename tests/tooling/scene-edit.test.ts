import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { DirectionalLight, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { sourceOf } from '@scenoco-three/core';
import {
  elementAt,
  elements,
  insertChild,
  readScene,
  removeAttribute,
  removeElement,
  setAttribute,
  type Element,
} from '@scenoco-three/tools';
import { Bob } from '../fixtures';

// A scene as a model writes one: comments (with non-ASCII — offsets must stay right), a constant, arithmetic,
// a shared material from code, attributes one per line, bare flags, self-closing tags, a behaviour.
const SCENE = `/** @jsxImportSource @scenoco-three/core */
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, Scene, SphereGeometry } from 'three';
import { Bob } from '../../fixtures';

const LANE = 2.2;
const shared = new MeshStandardMaterial();

export const Main = () => (
  <Scene>
    {/* the sun — it casts every shadow */}
    <DirectionalLight
      position={[3, 8, 5]}
      intensity={2}
      castShadow
    />
    <Group position={[LANE, 0, -4]}>
      <Mesh rotation={[-Math.PI / 2, 0, 0]} castShadow material={shared}>
        <BoxGeometry args={[1, 2, 3]} />
      </Mesh>
      <Mesh>
        <SphereGeometry />
        <MeshStandardMaterial color="#ff8800" roughness={0.4} />
        <Bob height={0.15} />
      </Mesh>
    </Group>
  </Scene>
);
`;

const DIR = new URL('./.tmp/', import.meta.url);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let builds = 0;
/** Write the scene and build it with the real runtime, as the game would. */
async function build(code: string): Promise<Scene> {
  mkdirSync(DIR, { recursive: true });
  const file = new URL(`scene-${++builds}.tsx`, DIR);
  writeFileSync(file, code);
  const module = (await import(/* @vite-ignore */ file.href)) as { Main: () => Scene };
  return module.Main();
}

/** Everything outside [start, end) of the original is still there, byte for byte. */
function onlyChanged(before: string, after: string, start: number, end: number): void {
  expect(after.slice(0, start)).toBe(before.slice(0, start));
  expect(after.slice(after.length - (before.length - end))).toBe(before.slice(end));
}

const tag = (code: string, name: string, n = 0): Element =>
  elements(readScene('scene.tsx', code)).filter((e) => e.tag === name)[n]!;

describe('editing a TSX scene', () => {
  it('reads every value it can work out, and names what it cannot', () => {
    const group = tag(SCENE, 'Group');
    expect(group.attributes[0]).toMatchObject({ name: 'position', value: { kind: 'value', value: [2.2, 0, -4] } });
    const box = tag(SCENE, 'Mesh');
    expect(box.attributes.find((a) => a.name === 'rotation')!.value).toEqual({ kind: 'value', value: [-Math.PI / 2, 0, 0] });
    expect(box.attributes.find((a) => a.name === 'castShadow')).toMatchObject({ text: null, value: { value: true } });
    expect(box.attributes.find((a) => a.name === 'material')!.value).toEqual({ kind: 'reference', text: 'shared' });
  });

  it('edits only what a person touched — move, rotate, recolour, a new attribute, a flag, a behaviour field', async () => {
    let code = SCENE;
    // [tag, which of that tag, attribute, value] — each looked up afresh, since every edit moves the text after it.
    const steps: [string, number, string, unknown][] = [
      ['Group', 0, 'position', [1.5, 0, -6]], // move
      ['Mesh', 0, 'rotation', [0, 0.7854, 0]], // rotate: the arithmetic becomes numbers
      ['MeshStandardMaterial', 0, 'color', '#3366ff'], // recolour
      ['Mesh', 1, 'scale', 2], // a new attribute
      ['DirectionalLight', 0, 'castShadow', false], // a bare flag turned off
      ['Bob', 0, 'height', 0.5], // a behaviour's field
    ];
    for (const [name, n, attribute, value] of steps) {
      const el = tag(code, name, n);
      const existing = el.attributes.find((a) => a.name === attribute);
      const next = setAttribute(code, el, attribute, value);
      if (existing) onlyChanged(code, next, existing.start, existing.end);
      else onlyChanged(code, next, el.attributesEnd, el.attributesEnd);
      code = next;
    }
    expect(code).toContain('rotation={[0, 0.7854, 0]}');
    expect(code).toContain('{/* the sun — it casts every shadow */}');
    expect(code).toContain('const LANE = 2.2;');

    const scene = await build(code);
    const light = scene.children[0] as DirectionalLight;
    const group = scene.children[1] as Group;
    const [box, ball] = group.children as [Mesh, Mesh<SphereLike, MeshStandardMaterial>];
    expect(group.position.toArray()).toEqual([1.5, 0, -6]);
    expect(box.rotation.y).toBeCloseTo(0.7854);
    expect(ball.material.color.getHexString()).toBe('3366ff');
    expect(ball.scale.toArray()).toEqual([2, 2, 2]);
    expect(light.castShadow).toBe(false);
    expect(ball.getComponent(Bob)!.height).toBe(0.5);
  });

  it('adds and removes elements and attributes, keeping the indentation of what is around them', async () => {
    let code = SCENE;
    code = insertChild(code, tag(code, 'Group'), '<Mesh position={[0, 3, 0]} />');
    code = insertChild(code, tag(code, 'BoxGeometry'), '<Bob />'); // into a self-closing tag
    code = removeElement(code, tag(code, 'MeshStandardMaterial'));
    code = removeAttribute(code, tag(code, 'DirectionalLight'), 'intensity');
    expect(code).toContain('      <Mesh position={[0, 3, 0]} />\n    </Group>');
    expect(code).toContain('        <BoxGeometry args={[1, 2, 3]}>\n          <Bob />\n        </BoxGeometry>');
    expect(code).toContain('      position={[3, 8, 5]}\n      castShadow\n    />');
    expect(code).not.toContain('MeshStandardMaterial color');

    const scene = await build(code.replace('<BoxGeometry args={[1, 2, 3]}>\n          <Bob />\n        </BoxGeometry>', '<BoxGeometry args={[1, 2, 3]} />'));
    const group = scene.children[1] as Group;
    expect(group.children).toHaveLength(3);
    expect((scene.children[0] as DirectionalLight).intensity).toBe(1); // back to three's default
  });

  it('finds the element that made a picked object, by where jsxDEV says it was written', async () => {
    const scene = await build(SCENE);
    const ball = (scene.children[1] as Group).children[1] as Mesh;
    const source = sourceOf(ball)!;
    expect(source).toBeDefined();
    const el = elementAt(readScene('scene.tsx', SCENE), source.lineNumber, source.columnNumber)!;
    expect(el.tag).toBe('Mesh');
    expect(el.children.map((c) => c.tag)).toEqual(['SphereGeometry', 'MeshStandardMaterial', 'Bob']);
  });
});

type SphereLike = import('three').SphereGeometry;
