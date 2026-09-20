import type { ConfigShape } from '../scan/interfaces.js';
import { hint, nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue, exampleEntries, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { TsModule, camelCase } from './module.js';

export interface ConfigDocumentOptions {
  /** Exported const name. */
  name: string;
  /** Source path, for the banner and diagnostics. */
  source: string;
  /** The type this document fills in — its name is the root tag, its fields are the vocabulary. */
  shape: ConfigShape;
  /** Where to import that type from. */
  module: string;
  /**
   * Resolve an `href` this document writes. A particle effect's `texture` is declared `Texture`,
   * so `<Renderer texture="../textures/spark.png" />` is an asset reference like a material's
   * `map` — and resolves to the same shared texture when it is the same image.
   */
  resolveAsset?: ResolveAsset;
}

/**
 * Compile a nested-element document — a `.particle.xml` — into one typed config object.
 *
 * Every element name comes from the type of the field it fills, so this emitter holds no
 * vocabulary of its own and works for whatever kind a package declares. The export is annotated
 * with the real type, so `tsc` is the last word: a document that produced a wrong-typed field
 * fails the build in the generated file, naming it.
 */
export function emitConfigDocument(
  root: SncElement,
  options: ConfigDocumentOptions,
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { name, source, shape } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );

  if (root.tag !== shape.name) {
    module.report(at(root, 'bad-root', `This document must be rooted at <${shape.name}>, not <${root.tag}>.`));
    return { diagnostics: module.diagnostics };
  }

  const assets = new AssetScope(module, options.resolveAsset ?? (() => undefined));
  const context: EmitContext = {
    require: (m, n) => module.require(m, n),
    nodeRef: () => undefined,
    assetRef: (href) => assets.reference(href),
    nearAsset: (href) => assets.near(href),
    assetType: (href) => assets.typeOf(href),
  };

  const local = module.declare(camelCase(name));
  const typeName = module.requireType(options.module, shape.name);

  const prefix = `export const ${local}: ${typeName} = `;
  module.line(`/** \`${source}\` */`);
  module.line(`${prefix}${text(emitObject(root, shape, module, context), '', prefix.length + 1)};`);

  return { ...(module.diagnostics.length === 0 ? { code: module.render() } : {}), diagnostics: module.diagnostics };
}

/**
 * The same value, written inside the element that uses it rather than in a file of its own.
 *
 * Standing alone or nested changes nothing about what an element says, so both go through the
 * same walk and the same writer. `room` is what the surrounding line already spends.
 */
export function emitConfigValue(
  element: SncElement,
  shape: ConfigShape,
  module: TsModule,
  context: EmitContext,
  room = 0,
): string {
  return text(emitObject(element, shape, module, context), '', room);
}

/** A value on its way to the generated file: one expression, an object, or a list of either. */
type Value = { code: string } | { object: Array<[string, Value]> } | { list: Value[] };

/**
 * One element as the object it fills in: its attributes are the plain fields, its children the
 * object ones — each matched by **the name of the type that field holds**, which is the one rule
 * the whole document shape follows.
 */
function emitObject(element: SncElement, shape: ConfigShape, module: TsModule, context: EmitContext): Value {
  const entries = new Map<string, Value>();
  const attributes = new Map<string, string>();
  readAttributes(element, shape, attributes, module, context);
  for (const [key, code] of attributes) entries.set(key, { code });
  for (const field of shape.fields) {
    if (field.required && !element.attributes.has(field.name)) {
      module.report(
        at(
          element,
          'missing-attribute',
          // A list's spelling is the one thing "…" does not show: `curve="[1, 0.5, 0]"`.
          `<${element.tag}> requires "${field.name}" — it has no default, so write it: ` +
            `${field.name}="${field.shape === 'array' ? `[${exampleEntries(field)}]` : '…'}".`,
        ),
      );
    }
  }

  const lists = new Map<string, Value[]>();
  for (const child of element.children) {
    const group = fieldFor(shape.groups, child.tag);
    if (group) {
      if (entries.has(group.field)) {
        module.report(
          at(child, 'duplicate-element', `<${child.tag}> is written twice inside <${element.tag}>. It fills one field, so there is one of it.`),
        );
        continue;
      }
      entries.set(group.field, emitObject(child, group.shape, module, context));
      continue;
    }
    const list = fieldFor(shape.lists, child.tag);
    if (list) {
      const into = lists.get(list.field) ?? [];
      into.push(emitObject(child, list.shape, module, context));
      lists.set(list.field, into);
      continue;
    }
    module.report(at(child, 'unknown-element', unknownElement(child.tag, element.tag, shape)));
  }
  for (const [field, written] of lists) entries.set(field, { list: written });

  return { object: [...entries].sort(byKey) };
}

function unknownElement(tag: string, owner: string, shape: ConfigShape): string {
  // `<Curve>` inside `<SizeOverLifetime>`, whose `curve` is an attribute: a value written as a child.
  const field = shape.fields.find((f) => f.name.toLowerCase() === tag.toLowerCase());
  if (field) return `<${tag}> is the attribute ${field.name} of <${owner}> — write ${field.name}="…" on <${owner}>.`;
  const offered = [...shape.groups.values(), ...shape.lists.values()].map((s) => s.name);
  const suggestion = nearestName(tag, offered);
  if (suggestion) return `<${tag}> is not part of <${owner}>. Did you mean <${suggestion}>?`;
  if (offered.length === 0) return `<${owner}> holds no elements, only attributes, so <${tag}> has nowhere to go.`;
  return `<${tag}> is not part of <${owner}>. It holds ${offered.map((name) => `<${name}>`).join(', ')}.`;
}

/** One line for a value with nothing nested inside it, or nothing when it has. */
function flat(value: Value): string | undefined {
  if ('code' in value) return value.code;
  if ('object' in value) {
    const entries = value.object.map(([key, entry]) => {
      const inner = 'code' in entry ? entry.code : undefined;
      return inner === undefined ? undefined : `${key}: ${inner}`;
    });
    if (entries.some((entry) => entry === undefined)) return undefined;
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  const entries = value.list.map(flat);
  if (entries.some((entry) => entry === undefined)) return undefined;
  return `[${entries.join(', ')}]`;
}

/** The field whose type is named `tag`. */
function fieldFor(
  fields: ReadonlyMap<string, ConfigShape>,
  tag: string,
): { field: string; shape: ConfigShape } | undefined {
  for (const [field, shape] of fields) if (shape.name === tag) return { field, shape };
  return undefined;
}

/**
 * Render a value as an expression, wrapping only where it has to.
 *
 * A small leaf stays on its line — `{ count: 10, time: 0 }` is one thing to read, and spreading
 * it over four lines buries the document's structure in punctuation. Anything longer opens up.
 * `indent` is where wrapped lines start; `room` is what the surrounding line already spends, so
 * the choice is made against the line as it will be written.
 */
function text(value: Value, indent: string, room: number): string {
  if ('code' in value) return value.code;

  const inline = flat(value);
  if (inline !== undefined && indent.length + room + inline.length <= 92) return inline;

  const inner = `${indent}  `;
  if ('object' in value) {
    if (value.object.length === 0) return '{}';
    const entries = value.object.map(
      ([key, entry]) => `${inner}${key}: ${text(entry, inner, key.length + 3)},`,
    );
    return `{\n${entries.join('\n')}\n${indent}}`;
  }
  if (value.list.length === 0) return '[]';
  const entries = value.list.map((entry) => `${inner}${text(entry, inner, 1)},`);
  return `[\n${entries.join('\n')}\n${indent}]`;
}

/** Read every attribute of an element against a shape's fields. */
function readAttributes(
  element: SncElement,
  shape: ConfigShape,
  out: Map<string, string>,
  module: TsModule,
  context: EmitContext,
): void {
  for (const [attribute, text] of element.attributes) {
    if (attribute.includes(':')) continue; // xmlns and friends
    const field = shape.fields.find((f) => f.name === attribute);
    if (!field) {
      const advice = hint({
        near: nearestName(attribute, shape.fields.map((f) => f.name)),
        as: 'attribute',
        ask: element.tag,
        takes: shape.fields.map((f) => f.name),
      });
      module.report(
        at(element, 'unknown-attribute', `<${element.tag}> has no attribute "${attribute}".${advice.text}`, advice.ask),
      );
      continue;
    }
    const sibling = (name: string) => shape.fields.find((f) => f.name === name);
    const emitted = emitValue(field, text, element, { ...context, attribute: sibling });
    module.reportAll(emitted.diagnostics);
    if (emitted.code) out.set(attribute, emitted.code);
  }
}

const byKey = (a: readonly [string, unknown], b: readonly [string, unknown]) => a[0].localeCompare(b[0]);

function at(element: SncElement, code: string, message: string, ask?: string): SncDiagnostic {
  return {
    line: element.line,
    column: element.column,
    code,
    message,
    ...(element.file ? { file: element.file } : {}),
    ...(ask !== undefined ? { ask } : {}),
  };
}
