/**
 * Enums: a registered, named set of named choices usable as a `@property` /
 * node-attr type. Authored from a **native** TS enum, a const map, or — when each
 * member's name equals its value — a plain string array, so the runtime field
 * holds the real value (a Three.js constant, a planck body-type string, a TS enum
 * member) while XML/XSD/the editor work in readable member **names**.
 *
 *   const Side = enumOf('Side', { Front: THREE.FrontSide, Back: THREE.BackSide, Double: THREE.DoubleSide });
 *   @property({ type: Side, default: 'Front', description: 'Which faces render' }) side = THREE.FrontSide;
 *
 *   enum Kind { dynamic = 'dynamic', fixed = 'fixed' }   // a native TS enum works too
 *   const RigidBodyKind = enumOf('RigidBodyKind', Kind);
 *
 *   const UniformType = enumOf('UniformType', ['float', 'int', 'vec2']);  // name == value
 *
 * The native value is the compiled & runtime representation; the enum codec
 * (compiler) maps name↔value. `valueKind` tells the bundle whether to intern the
 * value (string) or store it raw (number).
 */
export interface EnumDef {
  readonly kind: 'enum';
  readonly name: string;
  /** Member names, in declaration order — the XML/XSD/editor surface. */
  readonly names: string[];
  readonly byName: Map<string, string | number>;
  readonly byValue: Map<string | number, string>;
  /** Whether members carry string or number values (homogeneous; from the first member). */
  readonly valueKind: 'string' | 'number';
  /** Native value of the first member — the fallback when an attribute is omitted. */
  readonly defaultValue: string | number;
}

const enums = new Map<string, EnumDef>();

/**
 * Register an enum from a native enum object, a `{ name: value }` const map, or a
 * string array (shorthand for an identity enum, member name == value). For a TS
 * **numeric** enum the reverse-mapping numeric keys (`0: 'A'`) are dropped,
 * leaving the member names. Re-registering the same name replaces it (hot-reload
 * / test friendly).
 */
export function enumOf(name: string, members: Record<string, string | number> | readonly string[]): EnumDef {
  // A bare string array means an identity enum: enumOf('UniformType', ['float', …]).
  const map: Record<string, string | number> = Array.isArray(members)
    ? Object.fromEntries(members.map((m) => [m, m]))
    : (members as Record<string, string | number>);
  // A TS numeric enum compiles to { A:0, B:1, 0:'A', 1:'B' } — keep only the
  // forward (non-numeric) keys as member names.
  const names = Object.keys(map).filter((k) => !/^\d+$/.test(k));
  if (names.length === 0) throw new Error(`enumOf("${name}") needs at least one member`);

  const byName = new Map<string, string | number>();
  const byValue = new Map<string | number, string>();
  for (const member of names) {
    const value = map[member]!;
    byName.set(member, value);
    if (!byValue.has(value)) byValue.set(value, member); // first name wins on duplicate values
  }
  const defaultValue = byName.get(names[0]!)!;
  const valueKind = typeof defaultValue === 'number' ? 'number' : 'string';

  const def: EnumDef = { kind: 'enum', name, names, byName, byValue, valueKind, defaultValue };
  enums.set(name, def);
  return def;
}

/** True for an `EnumDef` (used as a property/attr type token). */
export function isEnumType(t: unknown): t is EnumDef {
  return typeof t === 'object' && t !== null && (t as EnumDef).kind === 'enum';
}

export function getEnum(name: string): EnumDef | undefined {
  return enums.get(name);
}

/** Every registered enum — for XSD emission and editor discovery. */
export function allEnums(): EnumDef[] {
  return [...enums.values()];
}

/** Mainly for tests/hot-reload. */
export function unregisterEnum(name: string): boolean {
  return enums.delete(name);
}
