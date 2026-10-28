import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { handle, scenesIn } from '@scenoco-three/tools/vite';
import { Definitions } from '../../packages/tools/src/definitions.js';

// Its own folder, per run: test files run side by side, and each removes only what it made.
const root = new URL(`./.tmp/plugin-${process.pid}/`, import.meta.url).pathname;
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A request as Node's server hands it over: a stream with a method and a URL. */
function request(method: string, url: string, body?: object): IncomingMessage {
  return Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, url }) as unknown as IncomingMessage;
}

describe('the editor endpoints of scenoco()', () => {
  it('reads a scene, writes one attribute of one element, and refuses anything outside the project', async () => {
    mkdirSync(`${root}src`, { recursive: true });
    const scene = `${root}src/Main.tsx`;
    writeFileSync(scene, `// the level\nexport const Main = () => (\n  <Scene>\n    <Mesh position={[0, 1, 0]} castShadow />\n  </Scene>\n);\n`);
    const written = new Set<string>();

    const read = await handle(root, request('GET', '/scene?file=/src/Main.tsx'), written);
    expect(read.elements.map((e) => [e.tag, e.parent, e.line, e.column])).toEqual([['Scene', -1, 3, 3], ['Mesh', 0, 4, 5]]);
    expect(read.elements[1]!.attributes[0]).toMatchObject({ name: 'position', text: '{[0, 1, 0]}' });

    const mesh = { tag: 'Mesh', line: 4, column: 5 };
    const after = await handle(root, request('POST', '/set', { file: scene, index: 1, expect: mesh, name: 'position', value: [2, 1, -3] }), written);
    expect(after.elements[1]!.attributes[0]!.text).toBe('{[2, 1, -3]}');
    expect(readFileSync(scene, 'utf8')).toBe(`// the level\nexport const Main = () => (\n  <Scene>\n    <Mesh position={[2, 1, -3]} castShadow />\n  </Scene>\n);\n`);
    expect(written.has(scene)).toBe(true); // so the change does not reload the page

    // Undo writes text back exactly; text that is not a value is refused, and the file left alone.
    await handle(root, request('POST', '/set', { file: scene, index: 1, expect: mesh, name: 'position', text: '{[0, LIFT, 0]}' }), written);
    expect(readFileSync(scene, 'utf8')).toContain('<Mesh position={[0, LIFT, 0]} castShadow />');
    await expect(handle(root, request('POST', '/set', { file: scene, index: 1, expect: mesh, name: 'position', text: '{[0,' }), written)).rejects.toThrow(/not an attribute value/);

    // A file changed behind the editor's back is refused, never written at the wrong element.
    writeFileSync(scene, readFileSync(scene, 'utf8').replace('  <Scene>\n', '  <Scene>\n    <Group />\n'));
    await expect(handle(root, request('POST', '/set', { file: scene, index: 1, expect: mesh, name: 'visible', value: false }), written)).rejects.toThrow(
      /changed outside the editor: element 1 is <Group> at 4:5, not <Mesh> at 4:5/,
    );

    await expect(handle(root, request('GET', '/scene?file=/../outside.tsx'), written)).rejects.toThrow(/not a scene file of this project/);
    await expect(handle(root, request('GET', '/scene?file=/src/main.ts'), written)).rejects.toThrow(/not a scene file/);
  });
});

describe('the scenes the editor can open', () => {
  it('lists every exported constant written as a <Scene>, by the file the dev server serves it at', () => {
    const project = `${root}scenes/`;
    mkdirSync(`${project}src/scenes`, { recursive: true });
    mkdirSync(`${project}node_modules/lib`, { recursive: true });
    writeFileSync(`${project}src/scenes/Levels.tsx`, 'export const Forest = () => <Scene />;\nexport const Cave = () => (\n  <Scene>\n    <Group />\n  </Scene>\n);\nconst Hidden = () => <Scene />;\nexport const Pad = () => <Group />;\n');
    writeFileSync(`${project}node_modules/lib/Other.tsx`, 'export const Other = () => <Scene />;\n');
    expect(scenesIn(project)).toEqual([
      { file: '/src/scenes/Levels.tsx', name: 'Cave' },
      { file: '/src/scenes/Levels.tsx', name: 'Forest' },
    ]);
  });
});

describe('the links in an attribute', () => {
  it('leads each name to where the project declares it, through its import', async () => {
    const project = `${root}links/`;
    mkdirSync(`${project}src`, { recursive: true });
    writeFileSync(`${project}tsconfig.json`, JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', noEmit: true }, include: ['src'] }));
    writeFileSync(`${project}src/assets.ts`, 'export const terrains = {\n  meadow: 1,\n};\n');
    writeFileSync(`${project}src/Main.tsx`, "import { terrains } from './assets';\nexport const Main = () => <Scene><Terrain terrainData={terrains.meadow} /></Scene>;\n");
    const definitions = new Definitions(project.replace(/\/$/, ''));
    try {
      const links = await definitions.links(`${project}src/Main.tsx`);
      expect(links.map((l) => [l.name, l.from, l.to, l.file.endsWith('src/assets.ts'), l.line, l.column])).toEqual([
        ['terrainData', 1, 9, true, 1, 14],
        ['terrainData', 10, 16, true, 2, 3],
      ]);
      // A file changed on disk is read again, and the next question is still answered.
      writeFileSync(`${project}src/assets.ts`, '// moved down a line\nexport const terrains = {\n  meadow: 1,\n};\n');
      definitions.touched(`${project}src/assets.ts`);
      expect((await definitions.links(`${project}src/Main.tsx`)).map((l) => l.line)).toEqual([2, 3]);
    } finally {
      await definitions.close();
    }
  }, 20000);
});

describe('the fields an element declares', () => {
  it('reads kinds, options and private members from the types, and each constructor', async () => {
    const project = `${root}types/`;
    mkdirSync(`${project}src`, { recursive: true });
    writeFileSync(`${project}tsconfig.json`, JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
    writeFileSync(`${project}src/Spin.ts`, "export class Spin {\n  speed = 1;\n  axis: 'x' | 'y' = 'y';\n  private turned = 0;\n}\n");
    writeFileSync(`${project}src/Main.tsx`, "import { HemisphereLight, MeshBasicMaterial } from 'three';\nimport { Spin } from './Spin';\nexport const Main = () => <Scene><HemisphereLight args={['#fff', '#000', 1]} /><MeshBasicMaterial /><Spin /></Scene>;\n");
    const definitions = new Definitions(project.replace(/\/$/, ''));
    try {
      const types = await definitions.types(`${project}src/Main.tsx`);
      const at = (i: number) => types.find((t) => t.element === i)!;
      const [light, material, spin] = [at(1), at(2), at(3)];
      expect(light.constructors[0]!.map((p) => [p.name, p.field?.kind])).toEqual([['skyColor', 'color'], ['groundColor', 'color'], ['intensity', 'number']]);
      expect(light.fields.color).toEqual({ kind: 'color' });
      // three's \`side\`: its constants by name, imported from where the class came from.
      expect(material.fields.side).toMatchObject({ kind: 'option', options: expect.arrayContaining([{ label: 'DoubleSide', value: 2, text: '{DoubleSide}', import: { name: 'DoubleSide', from: 'three' } }]) });
      expect(spin.fields).toMatchObject({ speed: { kind: 'number' }, axis: { kind: 'option', options: [{ value: 'x', text: '"x"' }, { value: 'y', text: '"y"' }] } });
      expect(spin.hidden).toEqual(['turned']);
    } finally {
      await definitions.close();
    }
  }, 20000);
});

describe('opening a file from the editor', () => {
  it('runs the project’s command with the place filled in, and refuses anything outside the project', async () => {
    const { openFile } = await import('../../packages/tools/src/open.js');
    mkdirSync(`${root}src`, { recursive: true });
    const scene = `${root}src/Open.tsx`;
    writeFileSync(scene, 'export const Open = () => null;\n');
    const out = `${root}opened.txt`;
    const record = `node -e "require('fs').writeFileSync(process.argv[1], process.argv.slice(2).join(' '))" ${out} {file}:{line}:{col}`;
    await openFile(root.replace(/\/$/, ''), scene, 4, 7, 'custom', record);
    expect(readFileSync(out, 'utf8')).toBe(`${scene}:4:7`);

    await expect(openFile(root, '/etc/hosts', 1, 1, 'custom', record)).rejects.toThrow(/not a file of this project/);
    await expect(openFile(root, scene, 1, 1, 'custom', null)).rejects.toThrow(/set scenoco\(\{ editor/);
    await expect(openFile(root, scene, 1, 1, 'custom', 'no-such-editor {file}')).rejects.toThrow(/not a command on the dev server's PATH/);
  });
});
