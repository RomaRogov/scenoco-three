import type { ProjectModel, PropInfo, TagInfo } from '../model.js';
import type { SncDiagnostic } from '../dsl/diagnostics.js';
import { PLACEMENT } from './placement.js';
import { hint, nearestName } from '../dsl/diagnostics.js';
import type { SncElement } from '../dsl/parse.js';
import { emitValue, type EmitContext } from '../dsl/value.js';
import { AssetScope, type ResolveAsset } from './assets.js';
import { TsModule, camelCase } from './module.js';
import { isAttachable } from '../scan/families.js';

/**
 * An `.asset.xml`: one element, one exported value, rooted at any class a node is built from.
 *
 * The value is a **module-scope singleton**, so fifty meshes naming it share one and the sharing
 * is legible as an import. Writing the element inside a node gives that node its own instead —
 * three.js's distinction between a `const` and a `new` in the argument.
 */
export function emitResource(
  root: SncElement,
  options: {
    name: string;
    model: ProjectModel;
    source: string;
    /**
     * Resolve an `href` this document writes. A material's `map` is declared `Texture`, so it
     * reads as an asset reference like any other — this is what lets it reach one.
     */
    resolveAsset?: ResolveAsset;
  },
): { code?: string; diagnostics: SncDiagnostic[] } {
  const { name, model, source } = options;
  const module = new TsModule(
    `// GENERATED from ${source} — do not edit.\n// Regenerate with \`scenoco build\`.`,
  );

  const tag = model.tags.find((t) => t.name === root.tag);
  if (!tag || !isAttachable(tag.family)) {
    module.report(unknownTag(root, model, tag?.family));
    return { diagnostics: module.diagnostics };
  }
  if (tag.family === 'texture') {
    module.report({
      line: root.line,
      column: root.column,
      code: 'wrong-kind',
      message:
        `<${root.tag}> takes its data from an image file rather than from attributes, so it is ` +
        'written as a .texture.xml — which names the image with src=.',
      ...(source ? { file: source } : {}),
    });
    return { diagnostics: module.diagnostics };
  }
  if (root.children.length > 0) {
    module.report({
      line: root.children[0]!.line,
      column: root.children[0]!.column,
      code: 'unexpected-child',
      message: `An .asset.xml is a single <${root.tag}> element; it has no children.`,
      ...(source ? { file: source } : {}),
    });
  }

  const local = module.declare(camelCase(name));
  const assets = new AssetScope(module, options.resolveAsset ?? (() => undefined));
  const context: EmitContext = {
    require: (m, n) => module.require(m, n),
    nodeRef: () => undefined,
    assetRef: (href) => assets.reference(href),
  };
  const { call, assignments } = buildConstruction(tag, root, module, context);

  // `shared()` says this module owns the value, so `Scene.unload` leaves it alone. Without it,
  // fifty scenes importing one material means the first one to unload disposes it out from
  // under the other forty-nine — the sharing is the whole point of the file existing.
  const sharedFn = module.require('@scenoco-three/core', 'shared');
  module.line(`/** \`${source}\` */`);
  module.line(`export const ${local} = ${sharedFn}(${call});`);
  for (const assignment of assignments) module.line(`${local}.${assignment}`);

  return { code: module.render(), diagnostics: module.diagnostics };
}

/**
 * Turn one element's attributes into a `new Tag(...)` call plus the assignments that follow.
 *
 * Constructor parameters are emitted **positionally**, filling any gap with `undefined`, so a
 * document that sets the third parameter and not the second still produces a correct call —
 * and never silently shifts values into the wrong slots.
 *
 * `attached` holds parameters already built from child elements. They fill the same slots an
 * attribute would, so a slot given both is reported rather than one of the two silently winning.
 */
export function buildConstruction(
  tag: TagInfo,
  element: SncElement,
  module: TsModule,
  context: EmitContext,
  skip: ReadonlySet<string> = new Set(),
  attached: ReadonlyMap<string, string> = new Map(),
): { call: string; assignments: string[] } {
  const byName = new Map<string, PropInfo>();
  for (const parameter of tag.parameters) byName.set(parameter.name, parameter);
  for (const property of tag.properties) byName.set(property.name, property);

  const parameterCodes = new Map<string, string>();
  const assignments: string[] = [];

  for (const [attribute, text] of element.attributes) {
    if (skip.has(attribute) || attribute.includes(':')) continue;
    const prop = byName.get(attribute);
    if (!prop) {
      module.report(unknownAttribute(element, attribute, tag));
      continue;
    }
    const emitted = emitValue(prop, text, element, context);
    module.reportAll(emitted.diagnostics);
    if (!emitted.code) continue;

    if (tag.parameters.some((p) => p.name === attribute)) parameterCodes.set(attribute, emitted.code);
    else assignments.push(`${attribute} = ${emitted.code};`);
  }

  for (const [name, code] of attached) {
    if (parameterCodes.has(name)) {
      module.report({
        line: element.line,
        column: element.column,
        code: 'duplicate-slot',
        message:
          `<${tag.name}> takes one ${name}, and this one has a ${name}= as well as a ${name} ` +
          'element inside it. Name a file to share one, or write the element to give this node its own.',
        ...(element.file ? { file: element.file } : {}),
      });
      continue;
    }
    parameterCodes.set(name, code);
  }

  const local = module.require(tag.module, tag.name);

  // A material takes one options object; everything authored on it belongs in there, which is
  // also how three.js wants it — several material properties are only honoured at construction.
  if (tag.family === 'material') {
    const entries = assignments.map((a) => a.replace(/ = /, ': ').replace(/;$/, ''));
    if (entries.length === 0) return { call: `new ${local}()`, assignments: [] };
    return { call: `new ${local}({\n  ${entries.join(',\n  ')},\n})`, assignments: [] };
  }

  const args: string[] = [];
  let lastSet = -1;
  tag.parameters.forEach((parameter, index) => {
    if (parameterCodes.has(parameter.name)) lastSet = index;
  });
  for (let index = 0; index <= lastSet; index++) {
    const parameter = tag.parameters[index]!;
    args.push(parameterCodes.get(parameter.name) ?? 'undefined');
  }
  return { call: `new ${local}(${args.join(', ')})`, assignments };
}

function unknownTag(element: SncElement, model: ProjectModel, family?: string): SncDiagnostic {
  const candidates = model.tags.filter((t) => isAttachable(t.family)).map((t) => t.name);
  const tagAdvice = hint({ near: nearestName(element.tag, candidates), as: 'tag', ask: element.tag });
  // A node at the root is the likely mistake, and it has its own answer: it belongs in a scene
  // or a prefab, which are the documents that hold a tree.
  const message =
    family === 'node'
      ? `<${element.tag}> is a node, and an .asset.xml holds one shared object rather than a ` +
        'tree. Put it in a .scene.xml or a .prefab.xml.'
      : `<${element.tag}> is not a three.js class a node is built from.${tagAdvice.text}`;
  return {
    line: element.line,
    column: element.column,
    code: 'unknown-tag',
    message,
    ...(family === 'node' ? {} : { ask: tagAdvice.ask }),
    ...(element.file ? { file: element.file } : {}),
  };
}

function unknownAttribute(element: SncElement, attribute: string, tag: TagInfo): SncDiagnostic {
  // Placement is consumed by its own pass, so it is absent from the tag's parameters and
  // properties — which meant `positon` on a <Mesh> got no "did you mean", the one misspelling
  // most likely to be made. The near-miss search has to see everything the element legally
  // accepts, not just the half of it this function is responsible for.
  const names = [
    ...[...tag.parameters, ...tag.properties].map((p) => p.name),
    ...Object.keys(PLACEMENT),
  ];
  const attrAdvice = hint({
    near: nearestName(attribute, names),
    as: 'attribute',
    ask: tag.name,
    takes: names,
  });
  return {
    line: element.line,
    column: element.column,
    code: 'unknown-attribute',
    message:
      `<${tag.name}> has no attribute "${attribute}".${attrAdvice.text}`,
    ask: attrAdvice.ask,
    ...(element.file ? { file: element.file } : {}),
  };
}
