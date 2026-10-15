import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { handle } from '@scenoco-three/tools/vite';

const root = new URL('./.tmp/plugin/', import.meta.url).pathname;
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
    expect(read.elements[1]!.attributes[0]).toMatchObject({ name: 'position', value: { kind: 'value', value: [0, 1, 0] } });

    const mesh = { tag: 'Mesh', line: 4, column: 5 };
    const after = await handle(root, request('POST', '/set', { file: scene, index: 1, expect: mesh, name: 'position', value: [2, 1, -3] }), written);
    expect(after.elements[1]!.attributes[0]!.value).toEqual({ kind: 'value', value: [2, 1, -3] });
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
