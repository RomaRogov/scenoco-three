/**
 * `scenoco()` — the Vite plugin a SceNoCo project uses: TSX through core's JSX runtime, and, while
 * serving, the editor: its interface, and what it needs to read and write scene files.
 *
 * ```ts
 * // vite.config.ts
 * export default defineConfig({ plugins: [scenoco()] });
 * ```
 *
 * The editor opens over the running game, from a button `play()` puts on the page in development,
 * so it asks this server, never the disk:
 *
 * - `GET /__scenoco/editor.js` — its interface, `@scenoco-three/editor`'s one module.
 * - `POST /__scenoco/open` — `{ file, line, col, how }`: a project file in the code editor (`open.ts`);
 *   `GET` answers whether the project set a custom command for it.
 * - `GET /__scenoco/scenes` — the project's scenes: every exported constant written as a `<Scene>`,
 *   `{ file, name }` with `file` from the project's root — what the dev server serves it at.
 * - `GET /__scenoco/links?file=…` — every name in the file's attribute values that the project
 *   declares, and where, from the project's TypeScript (`definitions.ts`): the editor's links.
 * - `GET /__scenoco/types?file=…` — each element's fields and constructor arguments as declared:
 *   how the editor edits them, and which are private.
 * - `GET /__scenoco/scene?file=…` — a scene file read without running it: every element in
 *   document order, with its attributes' texts.
 * - `POST /__scenoco/set` — `{ file, index, expect, name, value }`: one attribute of one element,
 *   written by splicing its text (`scene-edit.ts`); everything else in the file stays byte for byte.
 *   `text` in place of `value` writes the attribute's text exactly as given — what undo puts back —
 *   and `import: { name, from }` adds the constant it names to the file's imports if missing.
 * - `POST /__scenoco/remove` — `{ file, index, expect, name }`.
 * - `POST /__scenoco/duplicate` — `{ file, index, expect }`: a copy of the element, with what it
 *   holds, right after it; answers where the copy is. `POST /__scenoco/delete` takes it out.
 *
 * None of them answers a request another site made.
 *
 * An element is addressed by its index in document order, which an attribute edit never changes.
 * `expect` is the element as the editor last read it — `{ tag, line, column }` — so a file changed
 * behind the editor's back (in an IDE, by an agent) is refused, never written at the wrong element.
 * A file the editor just wrote does not reload the page: the editor has already changed the live
 * object, and a reload would lose the camera and the selection.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createFilter, version, type Plugin } from 'vite';
import { Definitions } from './definitions.js';
import { customEditor, openFile, type OpenHow } from './open.js';
import { duplicateElement, elements, ensureImport, ownersOf, readScene, removeAttribute, removeElement, setAttribute, setAttributeText, type Element as SceneElement } from './scene-edit.js';

/** A scene file as the editor sees it: its elements, flat, in document order. */
export interface SceneJson {
  file: string;
  elements: {
    tag: string;
    line: number;
    column: number;
    /** Index of the enclosing element, or -1 for a root. */
    parent: number;
    /** The top-level constant it is written in — the scene's or prefab's name — if any. */
    owner?: string;
    /** `items`: a list's item texts, as written. */
    attributes: { name: string; text: string | null; items?: string[] }[];
  }[];
}

/** A scene the editor can open: `export const <name> = () => <Scene>…` in `file`, from the project's root. */
export interface SceneEntry {
  file: string;
  name: string;
}

/** A write from the editor. */
interface Write {
  file?: string;
  index?: number;
  expect?: { tag: string; line: number; column: number };
  name?: string;
  value?: unknown;
  text?: string | null;
  /** A constant the text names, imported if the file does not yet: `{DoubleSide}` from `three`. */
  import?: { name: string; from: string };
}

export interface ScenocoOptions {
  /**
   * How the editor's source links open a file, when the code editor is not found by itself: a
   * command with `{file}`, `{line}`, `{col}` and `{project}` — `'zed {file}:{line}:{col}'`,
   * `'code --goto {file}:{line}:{col}'`. `SCENOCO_EDITOR` says the same.
   */
  editor?: string;
  /**
   * The files written in SceNoCo's TSX, when the project has other TSX — a React app's. Left out,
   * every `.tsx` file is SceNoCo's. Given — `include: 'src/game/**'` — only these are, and the rest
   * keep the project's own JSX; exclude the same files from `@vitejs/plugin-react`.
   */
  include?: string | RegExp | readonly (string | RegExp)[];
}

/** The comment that has one file's JSX through core's runtime, whatever the project's is. */
const PRAGMA = '/** @jsxImportSource @scenoco-three/core */ ';

export function scenoco(options: ScenocoOptions = {}): Plugin {
  let root = process.cwd();
  const custom = customEditor(options.editor);
  /** Files this server just wrote for the editor: their next change is not a reload. */
  const written = new Set<string>();
  let definitions: Definitions | null = null;
  let ours: ((id: string) => boolean) | null = null;
  return {
    name: 'scenoco',
    // Before the TSX is compiled: `include`'s files are marked as core's first.
    enforce: 'pre',
    config: () => ({
      // Vite 8 transforms with oxc; 6 and 7 with esbuild, and 8 warns about the other's option.
      // With `include`, the project's JSX stays as it is, and only those files are core's.
      ...(options.include ? {} : Number(version.split('.')[0]) >= 8
        ? { oxc: { jsx: { runtime: 'automatic' as const, importSource: '@scenoco-three/core' } } }
        : { esbuild: { jsx: 'automatic' as const, jsxImportSource: '@scenoco-three/core' } }),
      // One `three` in the graph, or `instanceof` across two copies of it silently returns false.
      resolve: { dedupe: ['three'] },
    }),
    configResolved(config) {
      root = config.root;
      if (options.include) ours = createFilter(options.include as string | RegExp | (string | RegExp)[], null, { resolve: root });
    },
    transform(code, id) {
      if (!ours || !/\.[jt]sx$/.test(id.split('?')[0]!) || !ours(id)) return;
      // On the first line, not above it: every line keeps its number, which `sourceOf` reports.
      return { code: PRAGMA + code, map: null };
    },
    configureServer(server) {
      // The editor's endpoints write the project's files: a browser says when another site asked
      // (Sec-Fetch-Site), and they do not answer that.
      server.middlewares.use('/__scenoco/', (req, res, next) => {
        const site = req.headers['sec-fetch-site'];
        if (site === 'cross-site' || site === 'same-site') return send(res, 403, { error: "the editor's endpoints answer this page only" });
        next();
      });
      server.middlewares.use('/__scenoco/editor.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(createRequire(import.meta.url).resolve('@scenoco-three/editor/dist/editor.js')));
      });
      server.middlewares.use('/__scenoco/open', (req, res) => {
        if (req.method !== 'POST') return send(res, 200, { custom });
        text(req)
          .then((body) => {
            const { file = '', line = 1, col = 1, how = 'auto' } = JSON.parse(body) as { file?: string; line?: number; col?: number; how?: OpenHow };
            return openFile(root, file, line, col, how, custom);
          })
          .then(() => send(res, 200, { opened: true }))
          .catch((error: unknown) => send(res, 400, { error: error instanceof Error ? error.message : String(error) }));
      });
      server.middlewares.use('/__scenoco/scenes', (_req, res) => send(res, 200, scenesIn(root)));
      definitions = new Definitions(root);
      server.httpServer?.on('close', () => void definitions?.close());
      // What the project's TypeScript knows: each name's declaration, each element's declared fields.
      for (const what of ['links', 'types'] as const) {
        server.middlewares.use(`/__scenoco/${what}`, (req, res) => {
          Promise.resolve()
            .then((): Promise<unknown> => definitions![what](sceneFile(root, new URL(req.url ?? '/', 'http://x').searchParams.get('file'))))
            .then((found) => send(res, 200, found))
            .catch((error: unknown) => send(res, 400, { error: error instanceof Error ? error.message : String(error) }));
        });
      }
      server.middlewares.use('/__scenoco/', (req, res) => {
        handle(root, req, written)
          .then((body) => {
            // A duplicate or a delete is followed by a reload, which may come before the watcher sees
            // the change: the file's modules are made stale now, so the reload builds from the new file.
            if (/^\/(duplicate|delete)\b/.test(req.url ?? '')) {
              const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph;
              for (const module of graph.getModulesByFile(body.file) ?? []) graph.invalidateModule(module);
            }
            send(res, 200, body);
          })
          .catch((error: unknown) => send(res, 400, { error: error instanceof Error ? error.message : String(error) }));
      });
    },
    handleHotUpdate({ file }) {
      definitions?.touched(file);
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
  if (url.pathname === '/duplicate' || url.pathname === '/delete') return structural(file, code, all, body.index!, url.pathname === '/duplicate', written);
  if (typeof body.name !== 'string' || !/^[A-Za-z_$][\w$-]*$/.test(body.name)) throw new Error(`not an attribute name: ${body.name}`);
  let next: string;
  if (url.pathname === '/set' && body.text !== undefined) next = setAttributeText(code, element, body.name, body.text);
  else if (url.pathname === '/set') next = setAttribute(code, element, body.name, body.value);
  else if (url.pathname === '/remove') next = removeAttribute(code, element, body.name);
  else throw new Error(`no POST ${url.pathname}`);
  if (body.import) {
    const { name, from } = body.import;
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || typeof from !== 'string' || !from) throw new Error(`not an import: ${JSON.stringify(body.import)}`);
    next = ensureImport(file, next, name, from);
  }
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

/**
 * Duplicate or delete one element — with what it holds — and say where the copy is. Only an element
 * that is one of its parent's children: a scene's or a prefab's root is the whole of it, and an
 * element inside `{…}` is code's to repeat. The file must parse after, short exactly that subtree
 * or long exactly one more of it.
 */
function structural(file: string, code: string, all: SceneElement[], index: number, duplicate: boolean, written: Set<string>): SceneJson & { copy?: { line: number; column: number } } {
  const element = all[index]!;
  const doc = readScene(file, code);
  if (doc.roots.some((r) => r.start === element.start)) {
    throw new Error(`<${element.tag}> is the whole ${duplicate ? 'scene or prefab: a copy would be a second one' : 'scene or prefab: delete what is inside it instead'}`);
  }
  if (!all.some((e) => e.children.includes(element))) throw new Error(`<${element.tag}> is written inside {…}: change that code to ${duplicate ? 'repeat' : 'remove'} it`);
  const size = elements({ code, roots: [element] }).length;
  const next = duplicate ? duplicateElement(code, element) : removeElement(code, element);
  let after: SceneElement[];
  try {
    after = elements(readScene(file, next));
  } catch {
    after = [];
  }
  if (after.length !== all.length + (duplicate ? size : -size)) throw new Error(`<${element.tag}> cannot be ${duplicate ? 'duplicated' : 'deleted'} here: the file would not read as TSX after`);
  written.add(file);
  writeFileSync(file, next);
  const copy = duplicate ? after[index + size] : undefined;
  return { ...sceneJson(file), ...(copy && { copy: { line: copy.line, column: copy.column } }) };
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

/** @internal every exported constant of the project's `.tsx` files whose element is a `<Scene>`. Exported for the test. */
export function scenesIn(root: string): SceneEntry[] {
  const out: SceneEntry[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) out.push(...scenesOf(root, path));
    }
  };
  walk(root);
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}

function scenesOf(root: string, file: string): SceneEntry[] {
  try {
    const code = readFileSync(file, 'utf8');
    const owners = ownersOf(file, code).filter((o) => o.exported);
    const scenes = readScene(file, code).roots.filter((e) => e.tag === 'Scene');
    const names = new Set(scenes.map((e) => owners.find((o) => o.start <= e.start && e.end <= o.end)?.name).filter((n): n is string => !!n));
    return [...names].map((name) => ({ file: `/${relative(root, file).split('\\').join('/')}`, name }));
  } catch {
    // A file that does not parse right now is being written: it has no scenes to offer yet.
    return [];
  }
}

function sceneJson(file: string): SceneJson {
  const code = readFileSync(file, 'utf8');
  const all = elements(readScene(file, code));
  const owners = ownersOf(file, code);
  const parents = new Map<object, number>();
  all.forEach((element, i) => element.children.forEach((child) => parents.set(child, i)));
  return {
    file,
    elements: all.map((element) => ({
      tag: element.tag,
      line: element.line,
      column: element.column,
      parent: parents.get(element) ?? -1,
      owner: owners.find((o) => o.start <= element.start && element.end <= o.end)?.name,
      attributes: element.attributes.map(({ name, text, items }) => ({ name, text, ...(items && { items }) })),
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
