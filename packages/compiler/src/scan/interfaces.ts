import type { Checker, Type } from 'typescript/unstable/sync';
import type { PropInfo } from '../model.js';
import { propOf, shapeOf } from './shape.js';
import type { Workspace } from './workspace.js';

/**
 * A config interface, as a tree of authorable values.
 *
 * A nested object property becomes a nested `ConfigShape` rather than an unsupported value, so
 * `shape?: { type?: string; radius?: number }` is a group a document can fill in — which is
 * exactly how Unity's particle modules are organised, and therefore how a `.particle.xml`
 * reads.
 */
export interface ConfigShape {
  name: string;
  description?: string;
  fields: PropInfo[];
  /** Nested object properties, by field name. */
  groups: Map<string, ConfigShape>;
  /** Array-of-object properties, by field name — `bursts?: Array<{ time, count }>`. */
  lists: Map<string, ConfigShape>;
}

/**
 * Read one exported interface or type alias as a config shape.
 *
 * The point is the same as everywhere else here: the document's vocabulary is the type. A
 * particle config gains a field the moment the package declares one, and a document that sets
 * a field the package dropped is a build error rather than a key silently ignored at load.
 */
export function scanConfigShape(
  workspace: Workspace,
  moduleSpecifier: string,
  typeName: string,
): ConfigShape | undefined {
  const { checker } = workspace;
  for (const { sourceFile } of workspace.ownSourceFiles()) {
    const moduleSymbol = workspace.moduleSymbolOf(moduleSpecifier, sourceFile);
    if (!moduleSymbol) continue;
    const exported = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === typeName);
    if (!exported) continue;
    const type = checker.getDeclaredTypeOfSymbol(exported);
    if (!type) continue;
    return describe(typeName, type, checker, 0);
  }
  return undefined;
}

/** How deep a config may nest before the scan stops. Three is more than any real config uses. */
const MAX_DEPTH = 3;

function describe(name: string, type: Type, checker: Checker, depth: number): ConfigShape {
  const shape: ConfigShape = { name, fields: [], groups: new Map(), lists: new Map() };
  if (depth > MAX_DEPTH) return shape;

  for (const symbol of checker.getPropertiesOfType(type)) {
    const propertyType = checker.getTypeOfSymbol(symbol);
    if (!propertyType) continue;
    const resolved = checker.getNonNullableType(propertyType) ?? propertyType;
    const classified = shapeOf(propertyType, checker);

    if (classified.shape !== 'unsupported' && classified.shape !== 'array') {
      shape.fields.push(propOf(symbol, checker));
      continue;
    }

    // `bursts?: Array<{ time: number; count: number }>` — a list of groups, authored as
    // repeated child elements rather than as one attribute.
    if (checker.isArrayType(resolved) && resolved.isTypeReference()) {
      const element = checker.getTypeArguments(resolved)[0];
      const elementShape = element ? shapeOf(element, checker) : undefined;
      if (element && elementShape?.shape === 'unsupported') {
        shape.lists.set(symbol.name, describe(symbol.name, element, checker, depth + 1));
        continue;
      }
      shape.fields.push(propOf(symbol, checker));
      continue;
    }

    // A plain nested object: a module in Unity's sense.
    if (checker.getPropertiesOfType(resolved).length > 0) {
      shape.groups.set(symbol.name, describe(symbol.name, resolved, checker, depth + 1));
      continue;
    }

    shape.fields.push(propOf(symbol, checker));
  }

  shape.fields.sort((a, b) => a.name.localeCompare(b.name));
  return shape;
}
