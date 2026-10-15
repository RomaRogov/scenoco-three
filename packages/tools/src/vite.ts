/**
 * `scenoco()` — the Vite plugin a SceNoCo project uses: TSX through core's JSX runtime, and, while
 * serving, what the editor needs to read and write scene files.
 *
 * ```ts
 * // vite.config.ts
 * export default defineConfig({ plugins: [scenoco()] });
 * ```
 *
 * The editor runs in the game's own page (`?edit`), so it asks this server, never the disk:
 *
 * - `GET /__scenoco/scene?file=…` — a scene file read without running it: every element in
 *   document order, with its attributes' values where they can be worked out.
 * - `POST /__scenoco/set` — `{ file, index, expect, name, value }`: one attribute of one element,
 *   written by splicing its text (`scene-edit.ts`); everything else in the file stays byte for byte.
 *   `text` in place of `value` writes the attribute's text exactly as given — what undo puts back.
 * - `POST /__scenoco/remove` — `{ file, index, expect, name }`.
 *
 * An element is addressed by its index in document order, which an attribute edit never changes.
 * `expect` is the element as the editor last read it — `{ tag, line, column }` — so a file changed
 * behind the editor's back (in an IDE, by an agent) is refused, never written at the wrong element.
 * A file the editor just wrote does not reload the page: the editor has already changed the live
 * object, and a reload would lose the camera and the selection.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { version, type Plugin } from 'vite';
import { elements, readScene, removeAttribute, setAttribute, setAttributeText, type Value } from './scene-edit.js';

/** A scene file as the editor sees it: its elements, flat, in document order. */
export interface SceneJson {
  file: string;
  elements: {
    tag: string;
    line: number;
    column: number;
    /** Index of the enclosing element, or -1 for a root. */
    parent: number;
    attributes: { name: string; text: string | null; value: Value }[];
  }[];
}

/** A write from the editor. */
interface Write {
  file?: string;
  index?: number;
  expect?: { tag: string; line: number; column: number };
  name?: string;
  value?: unknown;
  text?: string | null;
}

export function scenoco(): Plugin {
  let root = process.cwd();
  /** Files this server just wrote for the editor: their next change is not a reload. */
  const written = new Set<string>();
  return {
    name: 'scenoco',
    config: () => ({
      // Vite 8 transforms with oxc; 6 and 7 with esbuild, and 8 warns about the other's option.
      ...(Number(version.split('.')[0]) >= 8
        ? { oxc: { jsx: { runtime: 'automatic' as const, importSource: '@scenoco-three/core' } } }
        : { esbuild: { jsx: 'automatic' as const, jsxImportSource: '@scenoco-three/core' } }),
      // One `three` in the graph, or `instanceof` across two copies of it silently returns false.
      resolve: { dedupe: ['three'] },
    }),
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/__scenoco/', (req, res) => {
        handle(root, req, written)
          .then((body) => send(res, 200, body))
          .catch((error: unknown) => send(res, 400, { error: error instanceof Error ? error.message : String(error) }));
      });
    },
    handleHotUpdate({ file }) {
      if (written.delete(file)) return [];
    },
  };
}

/** @internal one editor request, answered as JSON. Exported for the test. */
export async function handle(root: string, req: IncomingMessage, written: Set<string>): Promise<SceneJson> {
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'GET' && url.pathname === '/scene') return sceneJson(sceneFile(root, url.searchParams.get('file')));
  if (req.method !== 'POST') throw new Error(`no ${req.method} ${url.pathname}`);
  const body = JSON.parse(await text(req)) as Write;
  const file = sceneFile(root, body.file ?? null);
  const code = readFileSync(file, 'utf8');
  const all = elements(readScene(file, code));
  const element = all[body.index ?? -1];
  const expected = body.expect;
  if (!expected) throw new Error('which element? `expect: { tag, line, column }`, as the editor last read it');
  if (!element || element.tag !== expected.tag || element.line !== expected.line || element.column !== expected.column) {
    const now = element ? `<${element.tag}> at ${element.line}:${element.column}` : 'gone';
    throw new Error(
      `${relative(root, file)} changed outside the editor: element ${body.index} is ${now}, not <${expected.tag}> at ${expected.line}:${expected.column}. Reload the page.`,
    );
  }
  if (typeof body.name !== 'string' || !/^[A-Za-z_$][\w$-]*$/.test(body.name)) throw new Error(`not an attribute name: ${body.name}`);
  let next: string;
  if (url.pathname === '/set' && body.text !== undefined) next = setAttributeText(code, element, body.name, body.text);
  else if (url.pathname === '/set') next = setAttribute(code, element, body.name, body.value);
  else if (url.pathname === '/remove') next = removeAttribute(code, element, body.name);
  else throw new Error(`no POST ${url.pathname}`);
  // Text from the page is checked before it lands: the file must still parse, element for element.
  let parsed: number;
  try {
    parsed = elements(readScene(file, next)).length;
  } catch {
    parsed = -1;
  }
  if (parsed !== all.length) throw new Error(`not an attribute value: ${body.text ?? JSON.stringify(body.value)}`);
  if (next !== code) {
    written.add(file);
    writeFileSync(file, next);
  }
  return sceneJson(file);
}

/** A `.tsx` file inside the project — the only thing the editor may read or write. */
function sceneFile(root: string, file: string | null): string {
  if (!file) throw new Error('which file? ?file=…');
  // What `jsxDEV` reports: an absolute path, or one from the project's root.
  const path = isAbsolute(file) && file.startsWith(root) ? file : resolve(root, `.${file.startsWith('/') ? '' : '/'}${file}`);
  const inside = relative(root, path);
  if (inside.startsWith('..') || isAbsolute(inside) || !path.endsWith('.tsx')) throw new Error(`${file} is not a scene file of this project`);
  return path;
}

function sceneJson(file: string): SceneJson {
  const all = elements(readScene(file, readFileSync(file, 'utf8')));
  const parents = new Map<object, number>();
  all.forEach((element, i) => element.children.forEach((child) => parents.set(child, i)));
  return {
    file,
    elements: all.map((element) => ({
      tag: element.tag,
      line: element.line,
      column: element.column,
      parent: parents.get(element) ?? -1,
      attributes: element.attributes.map(({ name, text, value }) => ({ name, text, value })),
    })),
  };
}

function text(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => done(body));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
