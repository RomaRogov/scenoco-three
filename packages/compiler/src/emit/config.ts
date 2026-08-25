import type { ConfigShape } from '../scan/interfaces.js';
import { nearestName, type SncDiagnostic } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { TsModule, camelCase } from './module.js';

/**
 * How one authored element maps onto the config it fills in.
 *
 * A particle document is written in Unity's Shuriken vocabulary — `<Emission>`, `<Shape>`,
 * `<ColorOverLifetime>` — because that is the vocabulary the people and the models writing
 * these files already know. The config interface underneath uses its own field names. That
 * translation is a *naming convention*, and no type can express it, so it is the one thing
 * declared as data here. Everything else — which attributes exist, what they accept, what the
 * defaults are — still comes from the interface.
 */
export interface ModuleBinding {
  /** The element name as authored: `Emission`. */
  tag: string;
  /**
   * Where its attributes land. `''` merges them into the root object (Unity's `<Emission
   * rateOverTime>` is the config's top-level `rateOverTime`); a name nests them under it.
   */
  field: string;
  /** For a repeated element such as `<Burst>`: the array field it appends to. */
  list?: string;
  /**
   * A single attribute that *is* the value: `<SizeOverLifetime curve="[…]">` writes the
   * config's `sizeOverLifetime` directly rather than an object with a `curve` key.
   */
  from?: string;
}

export interface ConfigDocumentOptions {
  /** Exported const name. */
  name: string;
  /** Source path, for the banner and diagnostics. */
  source: string;
  /** The interface this document fills in. */
  shape: ConfigShape;
  /** The type to annotate the export with, and where to import it from. */
  type: { module: string; name: string };
  /** Element name the document must be rooted at. */
  rootTag: string;
  /** How each nested element maps onto the config. */
  bindings: readonly ModuleBinding[];
  /**
   * Resolve an `href` this document writes. A particle effect's `texture` is declared `Texture`,
   * so `<Renderer texture="../textures/spark.png" />` is an asset reference like a material's
   * `map` — and resolves to the same shared texture when it is the same image.
   */
  resolveAsset?: ResolveAsset;
}

/**
 * Compile a nested-module document — a `.particle.xml` — into one typed config object.
 *
 * The export is annotated with the real interface, so `tsc` is the last word: a document that
 * produced a wrong-typed field fails the build in the generated file, naming it.
 */
export function emitConfigDocument(
  root: SncElement,
  options: ConfigDocumentOptions,
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { name, source, shape, type, rootTag, bindings } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );

  if (root.tag !== rootTag) {
    module.report(at(root, 'bad-root', `This document must be rooted at <${rootTag}>, not <${root.tag}>.`));
    return { diagnostics: module.diagnostics };
  }

  const assets = new AssetScope(module, options.resolveAsset ?? (() => undefined));
  const context: EmitContext = {
    require: (m, n) => module.require(m, n),
    nodeRef: () => undefined,
    assetRef: (href) => assets.reference(href),
  };

  const values = new Map<string, string>();
  const groups = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();

  readAttributes(root, shape, values, module, context);

  for (const child of root.children) {
    const binding = bindings.find((b) => b.tag === child.tag);
    if (!binding) {
      const suggestion = nearestName(child.tag, bindings.map((b) => b.tag));
      module.report(
        at(child, 'unknown-module', `<${child.tag}> is not a module of <${rootTag}>.` +
          (suggestion ? ` Did you mean <${suggestion}>?` : '')),
      );
      continue;
    }
    applyBinding(child, binding, { shape, values, groups, lists, module, context, bindings });
  }

  const local = module.declare(camelCase(name));
  const typeName = module.require(type.module, type.name);

  module.line(`/** \`${source}\` */`);
  module.block(`export const ${local}: ${typeName} = {`, () => {
    for (const [key, code] of [...values].sort(byKey)) module.line(`${key}: ${code},`);
    for (const [key, entries] of [...groups].sort(byKey)) {
      module.block(`${key}: {`, () => {
        for (const [inner, code] of [...entries].sort(byKey)) module.line(`${inner}: ${code},`);
      }, '},');
    }
    for (const [key, entries] of [...lists].sort(byKey)) {
      module.line(`${key}: [${entries.join(', ')}],`);
    }
  }, '};');

  return { ...(module.diagnostics.length === 0 ? { code: module.render() } : {}), diagnostics: module.diagnostics };
}

interface Sink {
  shape: ConfigShape;
  values: Map<string, string>;
  groups: Map<string, Map<string, string>>;
  lists: Map<string, string[]>;
  module: TsModule;
  context: EmitContext;
  bindings: readonly ModuleBinding[];
}

function applyBinding(element: SncElement, binding: ModuleBinding, sink: Sink): void {
  const { shape, module, context } = sink;

  // `<SizeOverLifetime curve="[…]">` — one attribute *is* the field.
  if (binding.from) {
    const field = shape.fields.find((f) => f.name === binding.field);
    const text = element.attributes.get(binding.from);
    if (!field) {
      module.report(at(element, 'unknown-module', `<${element.tag}> writes "${binding.field}", which this config has no field for.`));
      return;
    }
    if (text === undefined) {
      module.report(at(element, 'missing-attribute', `<${element.tag}> needs a "${binding.from}" attribute.`));
      return;
    }
    const emitted = emitValue(field, text, element, context);
    module.reportAll(emitted.diagnostics);
    if (emitted.code) sink.values.set(binding.field, emitted.code);
    return;
  }

  // `<Burst time="0" count="10" />` — one entry appended to an array field.
  if (binding.list) {
    const listShape = shape.lists.get(binding.list);
    if (!listShape) {
      module.report(at(element, 'unknown-module', `<${element.tag}> appends to "${binding.list}", which this config has no field for.`));
      return;
    }
    const entries = new Map<string, string>();
    readAttributes(element, listShape, entries, module, context);
    const rendered = `{ ${[...entries].sort(byKey).map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
    const existing = sink.lists.get(binding.list) ?? [];
    existing.push(rendered);
    sink.lists.set(binding.list, existing);
    return;
  }

  // `<Emission rateOverTime="90">` — attributes merged into the root object.
  if (binding.field === '') {
    readAttributes(element, shape, sink.values, module, context);
    for (const child of element.children) {
      const nested = sink.bindings.find((b) => b.tag === child.tag);
      if (nested) applyBinding(child, nested, sink);
      else module.report(at(child, 'unknown-module', `<${child.tag}> is not a module of <${element.tag}>.`));
    }
    return;
  }

  // `<Shape type="Cone" radius="0.35">` — attributes nested under a group.
  const groupShape = shape.groups.get(binding.field);
  if (!groupShape) {
    module.report(at(element, 'unknown-module', `<${element.tag}> writes "${binding.field}", which this config has no group for.`));
    return;
  }
  const entries = sink.groups.get(binding.field) ?? new Map<string, string>();
  readAttributes(element, groupShape, entries, module, context);
  sink.groups.set(binding.field, entries);
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
      const suggestion = nearestName(attribute, shape.fields.map((f) => f.name));
      module.report(
        at(element, 'unknown-attribute', `<${element.tag}> has no attribute "${attribute}".` +
          (suggestion ? ` Did you mean "${suggestion}"?` : '')),
      );
      continue;
    }
    const emitted = emitValue(field, text, element, context);
    module.reportAll(emitted.diagnostics);
    if (emitted.code) out.set(attribute, emitted.code);
  }
}

const byKey = (a: readonly [string, unknown], b: readonly [string, unknown]) => a[0].localeCompare(b[0]);

function at(element: SncElement, code: string, message: string): SncDiagnostic {
  return {
    line: element.line,
    column: element.column,
    code,
    message,
    ...(element.file ? { file: element.file } : {}),
  };
}
