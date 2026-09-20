import { SymbolFlags, type Project, type Type } from 'typescript/unstable/sync';
import type { PropInfo } from '../model.js';
import { docOfSymbol, docTagOfSymbol } from './ast-utils.js';
import { propOf, shapeOf } from './shape.js';
import type { Workspace } from './workspace.js';

/**
 * A config type, as a tree of authorable values — one document kind's whole vocabulary.
 *
 * One rule decides the shape of the document: **an element is named by the type of the field, and
 * the field says where the value lands.** A nested object is a child element, an array of objects
 * is that element repeated, and everything else is an attribute. It is the same rule a tag
 * follows — a tag is a class name — so a package declaring a document kind declares types, not a
 * table of names.
 *
 * ```ts
 * interface ParticleEffect { duration?: number; emission?: Emission }
 * interface Emission { rateOverTime?: number; bursts?: Burst[] }
 * ```
 * ```xml
 * <ParticleEffect duration="3"><Emission rateOverTime="90"><Burst time="0" count="10" /></Emission></ParticleEffect>
 * ```
 */
export interface ConfigShape {
  /** The type's name, which is the element's name. */
  name: string;
  description?: string;
  fields: PropInfo[];
  /** Nested object properties, by field name. */
  groups: Map<string, ConfigShape>;
  /** Array-of-object properties, by field name — `bursts?: Burst[]`. */
  lists: Map<string, ConfigShape>;
  /**
   * Why part of this type cannot be authored — an anonymous object, two fields of one type.
   * Reported against the package that declared it, because that is whose mistake it is.
   */
  problems?: string[];
}

/**
 * Read one exported interface, type alias or class as a config shape.
 *
 * The point is the same as everywhere else here: the document's vocabulary is the type. A config
 * gains an attribute the moment the package declares a field, and a document that sets a field
 * the package dropped is a build error rather than a key silently ignored at load.
 */
export function scanConfigShape(
  workspace: Workspace,
  moduleSpecifier: string,
  typeName: string,
  /** The types that author as a path — one config may reference another kind's document. */
  documents?: ReadonlySet<string>,
): ConfigShape | undefined {
  const { checker } = workspace;
  for (const { sourceFile } of workspace.ownSourceFiles()) {
    const moduleSymbol = workspace.moduleSymbolOf(moduleSpecifier, sourceFile);
    if (!moduleSymbol) continue;
    const exported = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === typeName);
    if (!exported) continue;
    const type = checker.getDeclaredTypeOfSymbol(exported);
    if (!type) continue;
    return describe(typeName, type, workspace, 0, documents);
  }
  return undefined;
}

/** How deep a config may nest before the scan stops. Three is more than any real config uses. */
const MAX_DEPTH = 3;

function describe(
  name: string,
  type: Type,
  workspace: Workspace,
  depth: number,
  documents?: ReadonlySet<string>,
): ConfigShape {
  const { checker, project } = workspace;
  // The same JSDoc the IDE shows on hover, on the element and on every attribute. Without it a
  // config printed as a bare list of names and types, which is a table of contents, not an answer.
  const doc = symbolOf(type) && docOfSymbol(symbolOf(type)!, project);
  const shape: ConfigShape = {
    name,
    ...(doc ? { description: doc } : {}),
    fields: [],
    groups: new Map(),
    lists: new Map(),
  };
  if (depth > MAX_DEPTH) return shape;

  for (const symbol of checker.getPropertiesOfType(type)) {
    const propertyType = checker.getTypeOfSymbol(symbol);
    if (!propertyType) continue;
    const resolved = checker.getNonNullableType(propertyType) ?? propertyType;
    const classified = shapeOf(propertyType, checker, documents, project);
    const described = docOfSymbol(symbol, project);
    // `time: number` against `rateOverTime?: number`. Unlike a class field's initializer, the
    // question mark survives into a declaration file, so a package read as `.d.ts` says the same.
    const required = (symbol.flags & SymbolFlags.Optional) === 0;
    const tip = docTagOfSymbol(symbol, project, 'tip');
    const doc: Partial<PropInfo> = { required, ...(described ? { description: described } : {}), ...(tip ? { tip } : {}) };

    if (classified.shape !== 'unsupported' && classified.shape !== 'array') {
      shape.fields.push(propOf(symbol, checker, doc, documents, project));
      continue;
    }

    // `bursts?: Burst[]` — one element repeated, rather than one attribute.
    if (checker.isArrayType(resolved) && resolved.isTypeReference()) {
      const element = checker.getTypeArguments(resolved)[0];
      const elementShape = element ? shapeOf(element, checker, documents, project) : undefined;
      if (element && elementShape?.shape === 'unsupported') {
        nest(shape, symbol.name, element, workspace, depth, shape.lists, documents);
        continue;
      }
      shape.fields.push(propOf(symbol, checker, doc, documents, project));
      continue;
    }

    // A plain nested object: a module in Unity's sense.
    if (checker.getPropertiesOfType(resolved).length > 0) {
      nest(shape, symbol.name, resolved, workspace, depth, shape.groups, documents);
      continue;
    }

    shape.fields.push(propOf(symbol, checker, doc, documents, project));
  }

  shape.fields.sort((a, b) => a.name.localeCompare(b.name));
  return shape;
}

/** Record one child element, or say why it cannot be one. */
function nest(
  owner: ConfigShape,
  field: string,
  type: Type,
  workspace: Workspace,
  depth: number,
  into: Map<string, ConfigShape>,
  documents?: ReadonlySet<string>,
): void {
  const name = nameOf(type);
  if (!name) {
    problem(
      owner,
      `"${field}" is written as an inline object type, so there is no name to call its element by. ` +
        'Declare and export a named type for it — the element is named after the type.',
    );
    return;
  }
  const taken = [...owner.groups.values(), ...owner.lists.values()].find((shape) => shape.name === name);
  if (taken) {
    problem(
      owner,
      `"${field}" has the same type as another field of <${owner.name}>, so both would author as ` +
        `<${name}> and neither would say which field it filled. Give one of them its own type.`,
    );
    return;
  }
  into.set(field, describe(name, type, workspace, depth + 1, documents));
}

/** The symbol a type was declared by — an alias first, so `type X = {…}` documents itself. */
function symbolOf(type: Type) {
  return type.getAliasSymbol() ?? type.getSymbol();
}

/**
 * The declared name of a type, which is the name of its element.
 *
 * An inline object type is `__type`, a union or intersection has no symbol at all — both mean the
 * package wrote something with no name to put in a document.
 */
function nameOf(type: Type): string | undefined {
  const name = type.getAliasSymbol()?.name ?? type.getSymbol()?.name;
  if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !name.startsWith('__')) return name;
  return undefined;
}

function problem(shape: ConfigShape, message: string): void {
  (shape.problems ??= []).push(message);
}

/** Every problem in a shape and everything under it, deepest last. */
export function shapeProblems(shape: ConfigShape): string[] {
  return [
    ...(shape.problems ?? []),
    ...[...shape.groups.values(), ...shape.lists.values()].flatMap(shapeProblems),
  ];
}
