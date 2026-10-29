/**
 * What the project's own TypeScript knows about a scene file, for the editor:
 * - `links`: where each name in an attribute's value is declared — `terrains` in
 *   `{terrains.meadow}` is the `export const terrains` of `assets.ts`, through the import, and
 *   `meadow` its `meadow:` inside. The editor turns each name into a link.
 * - `types`: what each element's fields and constructor arguments are, from their declared types —
 *   a colour, a number, one of a few options — and which fields are private.
 *
 * TypeScript 7's API (the native compiler, `typescript/unstable/async`), from the project's own
 * `typescript`. It starts the first time it is asked, and again after a file changed. Without
 * it — an older TypeScript, none installed — there are no links, and nothing else changes.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { elements, readScene } from './scene-edit.js';

/** One name in an attribute's value, and where it is declared. */
export interface Link {
  /** The element, by index in document order, and the attribute. */
  element: number;
  name: string;
  /** The name's place in the attribute's text. */
  from: number;
  to: number;
  file: string;
  line: number;
  column: number;
}

/** What a field or an argument is, from its declared type: how the editor edits it. */
export type Field =
  | { kind: 'number' | 'boolean' | 'string' | 'color' | 'vector' | 'angles' }
  | { kind: 'option'; options: Option[] };

/** One of a few values a field takes: `'world'`, or a constant such as three's `DoubleSide`. */
export interface Option {
  label: string;
  value: string | number;
  /** How the file writes it: `"world"`, `{DoubleSide}`. */
  text: string;
  /** A constant the file must import to write it. */
  import?: { name: string; from: string };
}

/** One element's class, as its declarations say. */
export interface ElementTypes {
  element: number;
  /** The fields the editor can edit, by name. */
  fields: Record<string, Field>;
  /** `private` and `protected` members: not the element's to set. */
  hidden: string[];
  /** Each of the constructor's signatures: its parameters, in order. `args` is read against the one its length fits. */
  constructors: { name: string; field?: Field }[][];
  /** A function's tag — a prefab, a component: what each prop is when the tag leaves it out. */
  defaults?: Record<string, unknown>;
}

interface Api {
  updateSnapshot(params: object): Promise<Snapshot>;
  close(): Promise<void>;
}
interface Snapshot {
  getDefaultProjectForFile(file: string): Promise<Project | undefined>;
  dispose(): Promise<void>;
}
interface Project {
  checker: {
    getSymbolAtPosition(file: string, positions: readonly number[]): Promise<(Symbol | undefined)[]>;
    getAliasedSymbol(symbol: Symbol): Promise<Symbol>;
    getDeclaredTypeOfSymbol(symbol: Symbol): Promise<Type>;
    getPropertiesOfType(type: Type): Promise<readonly Symbol[]>;
    getTypeOfSymbol(symbols: readonly Symbol[]): Promise<(Type | undefined)[]>;
    getSignaturesOfType(type: Type, kind: number): Promise<readonly Signature[]>;
    getParameterType(signature: Signature, index: number): Promise<Type | undefined>;
    resolveName(name: string, meaning: number, location: { document: string; position: number }): Promise<Symbol | undefined>;
  };
  program: { getSourceFile(file: string): Promise<{ fileName: string; text: string } | undefined> };
}
interface Symbol {
  id: number;
  name: string;
  flags: number;
  declarations: readonly Declaration[];
  valueDeclaration?: Declaration;
}
interface Declaration {
  path: string;
  resolve(): Promise<{ pos: number; end: number; name?: { pos: number } } | undefined>;
}
interface Type {
  flags: number;
  value: string | number | boolean;
  getTypes(): Promise<readonly Type[] | undefined>;
  getSymbol(): Promise<Symbol | undefined>;
  getAliasSymbol(): Promise<Symbol | undefined>;
}
interface Signature {
  getParameters(): Promise<readonly Symbol[]>;
}

/** TypeScript's `SymbolFlags.Alias`: an import, which leads on to what it imports. */
const ALIAS = 2097152;
const CLASS = 32;
const VALUE = 111551;
const CONSTRUCT = 1;
const CALL = 0;
/** TypeScript's `SymbolFlags` of a value a tag can call: a function, or a `const` holding one. */
const FUNCTION = 16;
const VARIABLE = 3;
/** TypeScript's `TypeFlags`, those a field's kind is read from. */
const T = { String: 32, Number: 64, Boolean: 256, StringLiteral: 1024, NumberLiteral: 2048, BooleanLiteral: 8192, Undefined: 4, Null: 8, Union: 134217728 };
/** Classes whose instances the editor edits as one value. */
const VALUE_CLASSES: Record<string, 'color' | 'vector' | 'angles'> = { Color: 'color', Vector2: 'vector', Vector3: 'vector', Vector4: 'vector', Euler: 'angles' };

export class Definitions {
  private readonly root: string;
  private api: Promise<Api | null> | null = null;
  /** A project file changed since TypeScript read it. */
  private stale = false;

  constructor(root: string) {
    this.root = root;
  }

  /** A project file changed on disk. */
  touched(_file: string): void {
    this.stale = true;
  }

  /** Every name in the file's attribute values that is declared in the project, with where. */
  async links(file: string): Promise<Link[]> {
    const code = readFileSync(file, 'utf8');
    const names = elements(readScene(file, code)).flatMap((element, index) =>
      element.attributes.flatMap((attribute) =>
        (attribute.names ?? []).map((n) => ({ index, attribute, start: n.start, end: n.end })),
      ),
    );
    if (names.length === 0) return [];
    return this.withProject(file, [], async (project) => {
      const symbols = await project.checker.getSymbolAtPosition(file, names.map((n) => n.start));
      const links: Link[] = [];
      for (const [i, found] of symbols.entries()) {
        const at = found && (await declared(project, found));
        if (!at || !inside(this.root, at.file)) continue;
        const { index, attribute, start, end } = names[i]!;
        // The attribute's text starts at its value: `name=` comes before it.
        const textStart = attribute.end - (attribute.text?.length ?? 0);
        links.push({ element: index, name: attribute.name, from: start - textStart, to: end - textStart, ...at });
      }
      return links;
    });
  }

  /** Each element whose tag is a class: its fields and constructor arguments, as declared. */
  async types(file: string): Promise<ElementTypes[]> {
    const code = readFileSync(file, 'utf8');
    const all = elements(readScene(file, code));
    if (all.length === 0) return [];
    const imports = importsOf(file, code);
    return this.withProject(file, [], async (project) => {
      // At each tag's name, just after its `<`.
      const symbols = await project.checker.getSymbolAtPosition(file, all.map((e) => e.start + 1));
      const classes = new Map<number, Promise<Omit<ElementTypes, 'element'>>>();
      const out: ElementTypes[] = [];
      for (const [index, found] of symbols.entries()) {
        const symbol = found && (found.flags & ALIAS ? await project.checker.getAliasedSymbol(found) : found);
        if (!symbol || !(symbol.flags & (CLASS | FUNCTION | VARIABLE))) continue;
        const from = imports.get(all[index]!.tag);
        let known = classes.get(symbol.id);
        if (!known) classes.set(symbol.id, (known = symbol.flags & CLASS ? classOf(project, symbol, from) : propsOf(project, symbol, from)));
        out.push({ element: index, ...(await known) });
      }
      return out;
    });
  }

  /**
   * `run` against the project the file is in, as the files are now; `fallback` without TypeScript 7.
   * A TypeScript that fails or stops answering is let go, and the next question starts a new one.
   */
  private async withProject<R>(file: string, fallback: R, run: (project: Project) => Promise<R>): Promise<R> {
    // TypeScript's API does not read again a file it has read, whatever change it is told of: after a
    // change, a new one — it starts in tens of milliseconds — and the old one is let go.
    if (this.stale) {
      this.stale = false;
      const old = this.api;
      this.api = null;
      // Not at once: a question still on its way to it is answered first.
      setTimeout(() => void old?.then((a) => a?.close()).catch(() => {}), 15_000).unref();
    }
    const started = (this.api ??= start(this.root));
    const api = await started;
    if (!api) return fallback;
    const ask = async () => {
      const snapshot = await api.updateSnapshot({ openFiles: [file] });
      try {
        const project = await snapshot.getDefaultProjectForFile(file);
        return project ? await run(project) : fallback;
      } finally {
        await snapshot.dispose();
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silent = new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new Error('TypeScript did not answer in 10 s')), 10_000)));
    try {
      return await Promise.race([ask(), silent]);
    } catch (error) {
      if (this.api === started) this.api = null;
      void api.close().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    const api = await this.api;
    await api?.close();
  }
}

/** A class's fields — those the editor edits, and those it must not — and its constructor's parameters. */
async function classOf(project: Project, symbol: Symbol, from: string | undefined): Promise<Omit<ElementTypes, 'element'>> {
  const { checker } = project;
  const props = await checker.getPropertiesOfType(await checker.getDeclaredTypeOfSymbol(symbol));
  const types = await checker.getTypeOfSymbol(props);
  const fields: Record<string, Field> = {};
  const hidden: string[] = [];
  for (const [i, prop] of props.entries()) {
    if (await isPrivate(project, prop)) hidden.push(prop.name);
    else {
      const field = await fieldOf(project, types[i], from);
      if (field) fields[prop.name] = field;
    }
  }
  const [ctor] = await checker.getTypeOfSymbol([symbol]);
  const signatures = ctor ? await checker.getSignaturesOfType(ctor, CONSTRUCT) : [];
  const constructors = await Promise.all(
    signatures.map(async (signature) => {
      const parameters = await signature.getParameters();
      return Promise.all(parameters.map(async (p, i) => ({ name: p.name, field: await fieldOf(project, await checker.getParameterType(signature, i), from) })));
    }),
  );
  return { fields, hidden, constructors };
}

/**
 * A function's tag — `<BrickPrefab hits={2} />` — as a class's: its props are its fields, and each
 * default its parameter gives (`({ hits = 1 })`) is what the editor shows for a prop not written.
 */
async function propsOf(project: Project, symbol: Symbol, from: string | undefined): Promise<Omit<ElementTypes, 'element'>> {
  const none = { fields: {}, hidden: [], constructors: [] };
  const { checker } = project;
  const [type] = await checker.getTypeOfSymbol([symbol]);
  const [signature] = type ? await checker.getSignaturesOfType(type, CALL) : [];
  if (!signature) return none;
  const props = await checker.getParameterType(signature, 0);
  if (!props) return none;
  const members = await checker.getPropertiesOfType(props);
  const types = await checker.getTypeOfSymbol(members);
  const fields: Record<string, Field> = {};
  for (const [i, member] of members.entries()) {
    const field = await fieldOf(project, types[i], from);
    if (field && member.name !== 'children') fields[member.name] = field;
  }
  const [parameter] = await signature.getParameters();
  return { ...none, fields, defaults: parameter ? await defaultsOf(project, parameter) : {} };
}

/** `{ hits = 1, snap = true }`: each name a destructured parameter gives a literal default. */
async function defaultsOf(project: Project, parameter: Symbol): Promise<Record<string, unknown>> {
  const declaration = parameter.valueDeclaration ?? parameter.declarations[0];
  const node = declaration && (await declaration.resolve());
  const source = declaration && (await project.program.getSourceFile(declaration.path));
  if (!node || !source) return {};
  const text = source.text.slice(skipTrivia(source.text, node.pos), node.end);
  const defaults: Record<string, unknown> = {};
  try {
    const { program } = parseSync('params.ts', `(${text}) => 0`);
    const pattern = (program.body[0] as any)?.expression?.params?.items?.[0]?.pattern ?? (program.body[0] as any)?.expression?.params?.[0];
    for (const property of pattern?.properties ?? []) {
      const value = property.value;
      if (value?.type !== 'AssignmentPattern' || property.key?.type !== 'Identifier') continue;
      const right = value.right;
      if (right.type === 'Literal') defaults[property.key.name] = right.value;
      else if (right.type === 'UnaryExpression' && right.operator === '-' && typeof right.argument?.value === 'number') defaults[property.key.name] = -right.argument.value;
    }
  } catch {
    // A parameter this cannot read leaves its props without defaults: they show empty.
  }
  return defaults;
}

/** How the editor edits a value of this type, or undefined when it cannot. */
async function fieldOf(project: Project, type: Type | undefined, from: string | undefined): Promise<Field | undefined> {
  if (!type) return undefined;
  const flags = type.flags;
  if (flags & T.Union) {
    const parts = ((await type.getTypes()) ?? []).filter((t) => !(t.flags & (T.Undefined | T.Null)));
    if (parts.length === 1) return fieldOf(project, parts[0], from);
    if (parts.every((t) => t.flags & T.BooleanLiteral)) return { kind: 'boolean' };
    if (parts.every((t) => t.flags & T.StringLiteral)) {
      return { kind: 'option', options: parts.map((t) => ({ label: String(t.value), value: t.value as string, text: JSON.stringify(t.value) })) };
    }
    if (parts.every((t) => t.flags & T.NumberLiteral)) return named(project, type, from);
    // A colour written any way three takes one — `ColorRepresentation`: a Color among strings and numbers.
    for (const part of parts) if ((await part.getSymbol())?.name === 'Color') return { kind: 'color' };
    return undefined;
  }
  if (flags & (T.Number | T.NumberLiteral)) return { kind: 'number' };
  if (flags & (T.Boolean | T.BooleanLiteral)) return { kind: 'boolean' };
  if (flags & T.String) return { kind: 'string' };
  const name = (await type.getSymbol())?.name;
  return name && Object.hasOwn(VALUE_CLASSES, name) ? { kind: VALUE_CLASSES[name]! } : undefined;
}

/**
 * Numbers named by constants — three's `type Side = typeof FrontSide | typeof BackSide | …` — as the
 * constants: written by name, imported from where the element's class came from. A plain number
 * when they cannot be named.
 */
async function named(project: Project, type: Type, from: string | undefined): Promise<Field> {
  const alias = await type.getAliasSymbol();
  const declaration = alias?.declarations[0];
  const node = declaration && (await declaration.resolve());
  const source = declaration && (await project.program.getSourceFile(declaration.path));
  if (!from || !node || !source) return { kind: 'number' };
  const names = [...source.text.slice(node.pos, node.end).matchAll(/typeof\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
  if (names.length === 0) return { kind: 'number' };
  const constants = await Promise.all(names.map((n) => project.checker.resolveName(n, VALUE, { document: source.fileName, position: node.pos })));
  if (constants.some((c) => !c)) return { kind: 'number' };
  const values = await project.checker.getTypeOfSymbol(constants as Symbol[]);
  if (values.some((v) => typeof v?.value !== 'number')) return { kind: 'number' };
  return {
    kind: 'option',
    options: names.map((name, i) => ({ label: name, value: values[i]!.value as number, text: `{${name}}`, import: { name, from } })),
  };
}

/** Declared `private` or `protected`. */
async function isPrivate(project: Project, symbol: Symbol): Promise<boolean> {
  const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
  const node = declaration && (await declaration.resolve());
  const source = declaration && (await project.program.getSourceFile(declaration.path));
  if (!node || !source) return false;
  return /^(private|protected)\b/.test(source.text.slice(skipTrivia(source.text, node.pos), node.end));
}

/** Each name the file imports, and the module it comes from. */
function importsOf(file: string, code: string): Map<string, string> {
  const { program } = parseSync(file, code, { lang: 'tsx' }) as unknown as { program: { body: { type: string; source?: { value: string }; specifiers?: { local: { name: string } }[] }[] } };
  const out = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    for (const specifier of statement.specifiers ?? []) out.set(specifier.local.name, statement.source!.value);
  }
  return out;
}

/** TypeScript 7's API from the project's own install, or null when it has none. */
async function start(root: string): Promise<Api | null> {
  try {
    const path = createRequire(`${root}/package.json`).resolve('typescript/unstable/async');
    const { API } = (await import(pathToFileURL(path).href)) as { API: new (options: { cwd: string }) => Api };
    return new API({ cwd: root });
  } catch {
    return null;
  }
}

/** Where a symbol is declared — through an import to what it imports — at its name. */
async function declared(project: Project, found: Symbol): Promise<{ file: string; line: number; column: number } | null> {
  const symbol = found.flags & ALIAS ? await project.checker.getAliasedSymbol(found) : found;
  const declaration = symbol.declarations[0];
  const node = declaration && (await declaration.resolve());
  const source = declaration && (await project.program.getSourceFile(declaration.path));
  if (!node || !source) return null;
  // A node starts before the spaces and comments in front of it: the name itself is after them.
  const start = skipTrivia(source.text, node.name?.pos ?? node.pos);
  const before = source.text.slice(0, start).split('\n');
  return { file: source.fileName, line: before.length, column: before.at(-1)!.length + 1 };
}

function skipTrivia(text: string, at: number): number {
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    if (text.startsWith('//', at)) at = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at);
    else if (text.startsWith('/*', at)) at = text.indexOf('*/', at) === -1 ? text.length : text.indexOf('*/', at) + 2;
    else return at;
  }
}

/** A file of the project: what the editor may open. */
function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return !path.startsWith('..') && !isAbsolute(path) && !path.includes('node_modules');
}
