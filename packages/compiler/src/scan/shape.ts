import { SignatureKind, type Checker, type Symbol as TsSymbol, type Type } from 'typescript/unstable/sync';
import { ASSET_TYPES } from '../assets.js';
import type { PropInfo, ValueShape } from '../model.js';
import { baseChainOf } from './ast-utils.js';

/**
 * Decide how to author a value of a given type — the single question the whole DSL rests on.
 *
 * This is where `ValueType` used to live, as a decorator argument the author had to restate
 * and keep in step with the field's real type. Here it is *derived* from the type, so
 * `speed = 10` is a number because it is a number, and `side: Side` offers the right constants
 * because `Side` is a union of them.
 */
export function shapeOf(type: Type | undefined, checker: Checker): {
  shape: ValueShape;
  elementShape?: ValueShape;
  shapes?: ValueShape[];
  options?: string[];
} {
  if (!type) return { shape: 'unsupported' };

  // `number | undefined` on an optional parameter, `Side | undefined` on a material property:
  // strip the optionality before asking what the value actually is. `getNonNullableType` is
  // the checker's own answer, and unlike filtering the union by hand it keeps the alias — which
  // is the whole reason `ColorRepresentation` is still recognisable afterwards.
  let resolved = checker.getNonNullableType(type);
  if (!resolved) return { shape: 'unsupported' };
  // `Mesh<TGeometry, TMaterial>` declares its constructor in terms of its own type parameters,
  // so the parameter's *constraint* is what says what may be authored there. Without this
  // step every generic slot in three.js reads as unsupported — which is most of them.
  if (resolved.isTypeParameter()) {
    // `getConstraintOfTypeParameter` is the checker's own answer; `Type.getConstraint()` is
    // for conditional types and returns nothing here.
    const constraint =
      checker.getConstraintOfTypeParameter(resolved) ?? checker.getBaseConstraintOfType(resolved);
    if (!constraint) return { shape: 'unsupported' };
    resolved = constraint;
  }

  const printed = checker.typeToString(resolved);

  if (printed === 'number') return { shape: 'number' };
  if (printed === 'boolean') return { shape: 'boolean' };
  if (printed === 'string') return { shape: 'string' };

  // `ColorRepresentation` is `Color | string | number`, three's own alias for "a colour".
  const alias = resolved.getAliasSymbol()?.name ?? type.getAliasSymbol()?.name;
  if (alias === 'ColorRepresentation') return { shape: 'color' };
  // `SceneType` is `new () => Scene` — a scene *class*, which is what `SceneManager.load` takes.
  // A field declared with it is authored as a path to a `.scene.xml`, exactly like every other
  // reference to a document, so a level can name the level after it.
  if (alias && ASSET_TYPES.has(alias)) return { shape: 'assetRef' };

  const name = resolved.getSymbol()?.name;
  if (name === 'Color') return { shape: 'color' };
  if (name === 'Vector2') return { shape: 'vector2' };
  if (name === 'Vector3') return { shape: 'vector3' };
  if (name === 'Vector4') return { shape: 'vector4' };
  if (name === 'Euler' || name === 'Quaternion') return { shape: 'euler' };
  if (name === 'Texture') return { shape: 'assetRef' };
  // A type a document kind produces — `ParticleConfig` for a `.particle.xml`. The geometry and
  // material types are named here too, though the base-chain check below also reaches them:
  // a field declared exactly `BufferGeometry` should not depend on which branch sees it first.
  if (name && ASSET_TYPES.has(name)) return { shape: 'assetRef' };

  // An array authors as `[a, b, c]`; the element decides how each entry is written.
  const element = elementTypeOf(resolved, checker);
  if (element) {
    const inner = shapeOf(element, checker);
    return {
      shape: 'array',
      elementShape: inner.shape,
      ...(inner.shapes ? { shapes: inner.shapes } : {}),
      ...(inner.options ? { options: inner.options } : {}),
    };
  }

  // A union of literals — `Side`, `Blending`, `'static' | 'dynamic'` — is an enum. The member
  // names are the vocabulary, so a typo in the XML is caught here rather than by `tsc` later.
  const literals = literalMembersOf(resolved, checker);
  if (literals) return { shape: 'enum', options: literals };

  // A "one or many" union — three.js spells a material slot `Material | Material[]` — reduces
  // to the singular shape. An attribute names one thing; a document that needs several says so
  // with a bracketed list, which the array branch above already handles when the *declared*
  // type is an array rather than a union with one.
  const reduced = reduceUnion(resolved, checker);
  if (reduced) return reduced;

  // Anything that derives from Object3D is a reference to another node in the document.
  if (name) {
    const chain = [name, ...baseChainOf(resolved, checker)];
    if (chain.includes('Object3D')) return { shape: 'nodeRef' };
    if (chain.includes('BufferGeometry') || chain.includes('Material') || chain.includes('Texture')) {
      return { shape: 'assetRef' };
    }
    // A reference to another component — a typed handle, the way `Ball` holds a `Scoreboard`.
    if (chain.includes('Component')) return { shape: 'nodeRef' };
  }

  return { shape: 'unsupported' };
}

/** Describe one symbol (a parameter, a field, a property) as an authorable value. */
export function propOf(
  symbol: TsSymbol,
  checker: Checker,
  overrides: Partial<PropInfo> = {},
): PropInfo {
  const type = checker.getTypeOfSymbol(symbol);
  const { shape, elementShape, shapes, options } = shapeOf(type, checker);
  return {
    name: symbol.name,
    type: type ? checker.typeToString(type) : 'unknown',
    shape,
    ...(elementShape ? { elementShape } : {}),
    ...(shapes ? { shapes } : {}),
    ...(options ? { options } : {}),
    // Everything three.js takes is optional; a required value would mean the emitter has to
    // supply one, and there is nothing sensible to supply.
    required: false,
    ...overrides,
  };
}

/**
 * The element type of an array, or `undefined`.
 *
 * A tuple is deliberately not treated as an array: a tuple's arity is part of its contract and
 * the DSL has no way to honour it, so `[number, number]` reports as unsupported rather than
 * silently accepting the wrong length.
 */
function elementTypeOf(type: Type, checker: Checker): Type | undefined {
  if (!checker.isArrayType(type) || checker.isTupleType(type)) return undefined;
  if (!type.isTypeReference()) return undefined;
  return checker.getTypeArguments(type)[0];
}

/**
 * Classify a union: one shape when every member agrees, a `union` of the alternatives when
 * they do not.
 *
 * `X | X[]` agrees — three.js spells a material slot that way — and reduces to the singular
 * shape. `Color | Texture` does not, and stays a union whose branch the authored text picks.
 * Only a union with nothing authorable in it at all comes back undefined.
 */
function reduceUnion(
  type: Type,
  checker: Checker,
): { shape: ValueShape; elementShape?: ValueShape; shapes?: ValueShape[]; options?: string[] } | undefined {
  if (!type.isUnionType()) return undefined;
  const shapes = new Set<ValueShape>();
  for (const member of type.getTypes() ?? []) {
    const printed = checker.typeToString(member);
    if (printed === 'undefined' || printed === 'null') continue;
    const inner = shapeOf(member, checker);
    // An array member contributes its element's shape, so `Material[] | Material` agrees.
    shapes.add(inner.shape === 'array' ? (inner.elementShape ?? 'unsupported') : inner.shape);
  }
  shapes.delete('unsupported');
  if (shapes.size === 0) return undefined;
  if (shapes.size === 1) return { shape: [...shapes][0]! };
  // A union that genuinely mixes kinds — `Scene.background` is `Color | Texture | CubeTexture`.
  // Each alternative is authorable on its own, so the value stays authorable: which one a
  // document meant is decided by the text it wrote, at emit time.
  return { shape: 'union', shapes: [...shapes] };
}

/**
 * The literal member names of a union — `['FrontSide', 'BackSide', 'DoubleSide']`.
 *
 * three.js models its constants as `declare const FrontSide: 0` plus `type Side = 0 | 1 | 2`,
 * so the *type* only carries the numbers. The names come from the const declarations that
 * produce them, which is what makes the generated code read `FrontSide` rather than `0`.
 */
function literalMembersOf(type: Type, checker: Checker): string[] | undefined {
  if (!type.isUnionType()) {
    if (type.isStringLiteralType()) return [checker.typeToString(type)];
    return undefined;
  }
  const parts = type.getTypes() ?? [];
  const names: string[] = [];
  for (const part of parts) {
    const printed = checker.typeToString(part);
    if (printed === 'undefined' || printed === 'null') continue;
    if (!part.isLiteralType()) return undefined;
    names.push(printed);
  }
  return names.length > 0 ? names : undefined;
}

/** Construct signatures of a class's *static* side, i.e. what `new Foo(...)` accepts. */
export function constructSignaturesOf(type: Type, checker: Checker) {
  return checker.getSignaturesOfType(type, SignatureKind.Construct);
}
