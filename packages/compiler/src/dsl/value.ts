import { Color } from 'three';
import type { TagInfo } from '../model.js';
import type { PropInfo, ValueShape } from '../model.js';
import { hint, nearestName, type SncDiagnostic } from './diagnostics.js';
import type { SncElement } from './parse.js';

/**
 * What an emitted expression needs from the module around it: a `three` import, an import of
 * another generated asset, a reference to a node declared elsewhere in the same document.
 */
export interface EmitContext {
  /** Record that the module needs `name` from `module`, and return the local name to use. */
  require(module: string, name: string): string;
  /**
   * The expression that reaches the node with this `id`, or undefined if there is none. Given the
   * type the slot expects, a component type reaches the component *on* that node — dropping an
   * object on a component field, as in Unity's inspector — and `problem` says why it cannot.
   */
  nodeRef(id: string, expected?: string): { code: string } | { problem: string } | undefined;
  /** The expression for another asset document, given its path relative to this one. */
  assetRef(path: string): string | undefined;
  /**
   * Every tag in the project, where the caller has it — so an attribute a tag lacks can be
   * answered with the tags that do have it: `emissive` is not on <MeshBasicMaterial>, but is on
   * <MeshStandardMaterial>.
   */
  tags?: readonly TagInfo[];
  /**
   * Another attribute of the element being read, by name — so a rewrite that adds one offers it
   * only where it exists and takes that value: `#ff660000` is `opacity="0"` on a material, and on
   * a light, which has none, just the colour. Absent, a rewrite adds nothing.
   */
  attribute?(name: string): PropInfo | undefined;
  /**
   * The path a document probably meant by an `href` that resolves to nothing — the same file
   * written from the project root, or without its `.asset.xml` — relative to this document.
   */
  nearAsset?(href: string): string | undefined;
  /** The type a document at `href` is held as — see `AssetImport.type` — when it is a document. */
  assetType?(href: string): string | undefined;
}

export interface Emitted {
  /** The TypeScript expression, or undefined when the value could not be emitted. */
  code?: string;
  diagnostics: SncDiagnostic[];
}

/**
 * Turn one attribute's text into a TypeScript expression of the right type.
 *
 * The *shape* comes from the declared type — `roughness` is a number because three.js says
 * `roughness?: number`, and `side` offers `FrontSide`/`BackSide`/`DoubleSide` because `Side`
 * is a union of those literals. Nothing here consults a table of attribute names, which is why
 * the vocabulary tracks a three.js upgrade with no edit to this repo.
 */
export function emitValue(
  prop: PropInfo,
  text: string,
  element: SncElement,
  context: EmitContext,
): Emitted {
  const at: Fail = (code, message, rewrites = [], otherwise = '') => {
    // An exact rewrite is offered only when it compiles. Every one that did not was worse than
    // none: it cost a build to find out, and read as the tool contradicting itself.
    const offered = rewrites.find((rewrite) => compiles(prop, rewrite, element, context));
    // And whatever the declaration's own package says about this value, in its `@tip`.
    const text = (offered ? `${message} Write ${spelled(prop, offered)}.` : `${message}${otherwise}`) + (prop.tip ? ` ${prop.tip}` : '');
    return {
      diagnostics: [{ line: element.line, column: element.column, code, message: text, ...(element.file ? { file: element.file } : {}) }],
    };
  };

  // A slot declared `X | X[]` takes either, and the brackets say which.
  if (prop.list && prop.shape !== 'array' && text.trim().startsWith('[')) {
    return emitArray({ ...prop, shape: 'array', elementShape: prop.shape }, text, element, context, at);
  }

  switch (prop.shape) {
    case 'number': {
      // `#rrggbb` is a spelling of a number, and three.js takes `0xffdd66` in plenty of
      // places, so rejecting the hex spelling for a `number` field would be the tool being
      // pedantic about a notation it fully understands. It is an accommodation, not the
      // intent: **a colour property should be declared `Color`**, which is what gives it a
      // real `THREE.Color` in the generated code, an editor picker, and a type that says what
      // the field is.
      const hex = asHex(text);
      if (hex) return { code: hex, diagnostics: [] };
      const value = Number(text.trim());
      if (!Number.isFinite(value)) return at('bad-number', `${prop.name}="${text}" is not a number.`);
      return { code: String(value), diagnostics: [] };
    }

    case 'boolean': {
      const value = text.trim();
      if (value !== 'true' && value !== 'false') {
        return at('bad-boolean', `${prop.name}="${text}" must be "true" or "false".`);
      }
      return { code: value, diagnostics: [] };
    }

    case 'string':
      return { code: quote(text), diagnostics: [] };

    case 'color':
      return emitColor(prop, text, context, at);

    case 'vector2':
      return emitVector(prop, text, 2, context, at);
    case 'vector3':
    case 'euler':
      return emitVector(prop, text, 3, context, at);
    case 'vector4':
      return emitVector(prop, text, 4, context, at);

    case 'enum':
      return emitEnum(prop, text, context, at);

    case 'nodeRef': {
      const id = text.trim().replace(/^#/, '');
      // Only a plain class name narrows the slot: `Button`, not `Mesh<…>` or a list's element.
      const expected = /^[A-Za-z_$][\w$]*$/.test(prop.type) ? prop.type : undefined;
      // A path where a node goes: `coreTemplate="../prefabs/core.prefab.xml"` on an `Object3D` slot.
      if (!text.trim().startsWith('#') && /[/.]/.test(text)) {
        return at(
          'wrong-slot',
          `${prop.name}="${text}" is a path, and ${prop.name} is typed ${prop.type} — a node in this ` +
            `document, written '#id'. To spawn a prefab from a path, type the field PrefabType.`,
        );
      }
      const found = context.nodeRef(id, expected);
      if (!found) {
        return at(
          'unknown-id',
          `${prop.name}="${text}" points at id "${id}", which no node in this document declares.`,
        );
      }
      if ('problem' in found) return at('wrong-slot', `${prop.name}="${text}" ${found.problem}`);
      return { code: found.code, diagnostics: [] };
    }

    case 'assetRef': {
      if (text.trim().startsWith('[')) {
        return at(
          'unsupported-list',
          `${prop.name}="${text}" is a list, and ${prop.name} takes one asset. ` +
            'Set several from a component instead.',
        );
      }
      // A document of another kind than the field holds: `burstEffect!: PrefabType` given a
      // `.particle.xml` compiled, and `tsc` then failed on the generated file, naming nothing.
      const held = prop.document ? context.assetType?.(text.trim()) : undefined;
      if (held && held !== prop.document) {
        return at(
          'wrong-asset',
          `${prop.name}="${text}" is a ${held} document, and ${prop.name} is typed ${prop.document}. ` +
            `Type the field ${held} to hold this one, or point it at a ${prop.document === 'PrefabType' ? '.prefab.xml' : prop.document === 'SceneType' ? '.scene.xml' : `${prop.document} document`}.`,
        );
      }
      const reference = context.assetRef(text.trim());
      if (!reference) {
        // Written from the wrong place, most often — the project-root spelling, from inside
        // `assets/prefabs/`. Paths are relative to the document, so the fix is one exact path.
        const near = context.nearAsset?.(text.trim());
        return at(
          'unknown-asset',
          `${prop.name}="${text}" does not resolve to an asset in this project.` +
            (near ? ' Paths are relative to this document.' : ''),
          near ? [{ value: near }] : [],
        );
      }
      return { code: reference, diagnostics: [] };
    }

    case 'array':
      return emitArray(prop, text, element, context, at);

    case 'union':
      return emitUnion(prop, text, element, context, at);

    case 'unsupported':
      if (prop.unresolved) {
        // Nearly always a three.js class imported from the framework's own package. Name the one
        // module that has it, rather than leave "check its import" to a guess.
        const from = context.tags?.find((tag) => tag.name === prop.type)?.module;
        return at(
          'unsupported-type',
          `${prop.name} is typed ${prop.type}, and ${prop.type} does not resolve in that file — ` +
            (from
              ? `it comes from '${from}': import { ${prop.type} } from '${from}'.`
              : 'check its import: the module it names does not export it.'),
        );
      }
      // `scoreText!: Text` with nothing imported: TypeScript finds the browser's own `Text` — a DOM
      // node — so the name resolves, just not to the tag. Same answer as an unresolved one.
      // Only a node tag: a node class would have been read as a node reference, so reaching here
      // means the name found something else.
      const tag = context.tags?.find((t) => t.name === prop.type && t.family === 'node');
      if (tag) {
        return at(
          'unsupported-type',
          `${prop.name} is typed ${prop.type}, but that ${prop.type} is not the <${prop.type}> tag — with no import ` +
            `the name reaches another class of that name, such as the browser's. Import the tag's: ` +
            `import { ${prop.type} } from '${tag.module}'.`,
        );
      }
      if (prop.type === 'any' || prop.type === 'unknown') {
        return at(
          'unsupported-type',
          `${prop.name} is typed ${prop.type}, which says nothing about what it holds. Type it as what ` +
            "it holds: the class of the node (Mesh) or of the component it points at, written '#id'; or " +
            "PrefabType for a prefab to spawn, written as its path — crate=\"../prefabs/crate.prefab.xml\".",
        );
      }
      return at(
        'unsupported-type',
        `${prop.name} is typed ${prop.type}, which cannot be written as an attribute. ` +
          'Set it from a component instead.',
      );
  }
}

/**
 * An exact rewrite a diagnostic may hand back: the value to write instead, and any attribute it
 * adds beside it — `color="#ff6600" opacity="0.5"`.
 */
interface Rewrite {
  value: string;
  also?: ReadonlyArray<readonly [attribute: string, value: string]>;
}

/**
 * Report a value that does not compile. `rewrites` are tried in order and the first that compiles
 * is offered as `Write …`; when none does, `otherwise` says what the value has to be instead.
 */
type Fail = (code: string, message: string, rewrites?: readonly Rewrite[], otherwise?: string) => Emitted;

/**
 * Whether a rewrite would build: the value read again as the same attribute, and every attribute
 * it adds read as that attribute of this element. A list entry has no attributes of its own.
 */
function compiles(prop: PropInfo, rewrite: Rewrite, element: SncElement, context: EmitContext): boolean {
  if (emitValue(prop, rewrite.value, element, context).diagnostics.length > 0) return false;
  return (rewrite.also ?? []).every(([name, value]) => {
    if (isEntry(prop)) return false;
    const other = context.attribute?.(name);
    return other !== undefined && emitValue(other, value, element, context).diagnostics.length === 0;
  });
}

/** One entry of a list attribute, rather than an attribute of its own. */
function isEntry(prop: PropInfo): boolean {
  return prop.elementShape !== undefined && prop.shape !== 'array';
}

/**
 * `#rrggbb` or `#rgb` — always emitted as a real `THREE.Color`.
 *
 * Not the bare hex number, even though three.js accepts one wherever it takes a
 * `ColorRepresentation`. A field declared `tint: Color` accepts *only* a `Color`, so emitting
 * `0x38bdf8` for it would not compile — and `new Color(0x38bdf8)` is assignable everywhere the
 * number was. One spelling, correct in every position.
 *
 * ### The other formats three.js takes
 *
 * `THREE.Color` also accepts `0x38bdf8`, the CSS colour names (`tomato`), and the CSS colour
 * functions (`rgb(…)`, `hsl(…)`, and their `…a()` forms). None of them is a second way to
 * write a document — but all of them are read *here*, and answered with the exact hex to write
 * instead, so a near miss costs one line rather than a search for what `tomato` is in hex.
 *
 * The conversion is three.js's own parser, not a table in this repo, which is also what makes
 * the answer exact. Two things fall out of doing it at build time:
 *
 *  - `color="green"` is `#008000`, not bright green. Saying so in the diagnostic puts the
 *    surprising value in front of whoever wrote it, which accepting the name would not.
 *  - `color="tomatoe"` is a build error naming the nearest real colour. three.js at runtime
 *    warns to the console and leaves the colour untouched — a bug that renders.
 */
function emitColor(prop: PropInfo, text: string, context: EmitContext, at: Fail): Emitted {
  const value = text.trim();
  const hex = asHex(value);
  if (hex) return { code: `new ${context.require('three', 'Color')}(${hex})`, diagnostics: [] };

  const other = otherFormat(value);
  if (other) {
    return at('bad-color', `${prop.name}="${text}" is ${other.kind}; a document writes #rrggbb.`, [{ value: other.hex }]);
  }

  // `#rrggbbaa` and `#rgba`: valid CSS, and the one near miss three.js does not parse — it warns
  // to the console and leaves the colour untouched, which is a bug that renders. A colour here is
  // a `THREE.Color`, and a `THREE.Color` is r, g and b: the alpha has to go somewhere of its own,
  // so the fix names the attribute that takes it — `backgroundOpacity` beside `background`, else
  // `opacity` — where this element has one, and only the colour where it has none.
  const alpha = /^#(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8})$/.exec(value);
  if (alpha) {
    const rgb = value.length === 5 ? value.slice(0, 4) : value.slice(0, 7);
    const opacity = [`${prop.name}Opacity`, 'opacity'].find((name) => context.attribute?.(name));
    const withOpacity = opacity && !isEntry(prop) ? [{ value: rgb, also: [[opacity, String(alphaOf(value))]] as const }] : [];
    return at(
      'bad-color',
      `${prop.name}="${text}" carries an alpha channel, and a colour has no room for one — ` +
        `THREE.Color is r, g, b${withOpacity.length ? '' : ', and nothing here takes an opacity'}.`,
      [...withOpacity, { value: rgb }],
    );
  }

  // Not any format three.js understands. If it reads like a misspelt colour name, the nearest
  // one — and its hex, since that is what has to be written — is the whole fix.
  const near = /^[a-zA-Z]+$/.test(value) ? nearestName(value.toLowerCase(), COLOR_NAMES) : undefined;
  return near
    ? at('bad-color', `${prop.name}="${text}" is not a colour. The nearest CSS name is "${near}".`, [{ value: hexOfName(near) }])
    : at('bad-color', `${prop.name}="${text}" must be a hex colour such as "#38bdf8".`);
}

/** The alpha of a `#rrggbbaa` or `#rgba` colour, as the 0..1 number the document has to write. */
function alphaOf(value: string): number {
  const hex = value.length === 5 ? value.slice(4).repeat(2) : value.slice(7);
  return Math.round((parseInt(hex, 16) / 255) * 100) / 100;
}

/** Every CSS colour name three.js knows, straight from its own table. */
const COLOR_NAMES = Object.keys(Color.NAMES);

/**
 * Read one of the spellings three.js accepts but a document does not, and say what it is in
 * hex. Returns undefined for anything three.js could not read either.
 */
function otherFormat(value: string): { kind: string; hex: string } | undefined {
  const js = /^0x([0-9a-fA-F]{1,6})$/.exec(value);
  if (js) return { kind: 'JavaScript notation', hex: `#${js[1]!.padStart(6, '0').toLowerCase()}` };

  const name = value.toLowerCase();
  if (Object.hasOwn(Color.NAMES, name)) return { kind: 'a CSS colour name', hex: hexOfName(name) };

  // Guarded by the pattern, so `setStyle` is only ever handed something it can parse — an
  // unknown value there warns to the console and returns the previous colour, which would make
  // a wrong answer look like a right one.
  if (/^(rgb|hsl)a?\(/.test(name)) {
    const color = new Color();
    color.setStyle(value);
    return { kind: 'a CSS colour function', hex: `#${color.getHexString()}` };
  }
  return undefined;
}

function hexOfName(name: string): string {
  return `#${new Color(Color.NAMES[name as keyof typeof Color.NAMES]).getHexString()}`;
}

/** The `0x…` literal for `#rgb` or `#rrggbb`, or undefined for anything else. */
function asHex(text: string): string | undefined {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text.trim());
  if (!match) return undefined;
  const digits = match[1]!;
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  return `0x${full.toLowerCase()}`;
}

/**
 * `"x: 1; y: 2"` — the axis-named form, and the only one.
 *
 * There is deliberately no positional `"1 2 3"`. Two accepted spellings for one value is a coin
 * flip every time something writes a document, and in three dimensions the positional form is
 * the one that gets transposed. Naming the axis makes a wrong value visible in a diff and
 * impossible to misread.
 *
 * A positional value is not merely rejected: the diagnostic hands back the exact axis form to
 * write instead, so a near miss is a one-line fix rather than a puzzle. Omitted axes stay at
 * zero.
 */
function emitVector(
  prop: PropInfo,
  text: string,
  arity: 2 | 3 | 4,
  context: EmitContext,
  at: Fail,
): Emitted {
  const axes = AXES.slice(0, arity);
  const parts = new Array<number>(arity).fill(0);
  const value = text.trim();

  if (!value.includes(':')) {
    const rewritten = asAxisForm(value, arity);
    return at(
      'bad-vector',
      `${prop.name}="${text}" needs its axes named.`,
      rewritten ? [{ value: rewritten }] : [],
      ` Write the axis form, e.g. ${prop.name}="${axes.map((axis, index) => `${axis}: ${index}`).join('; ')}".`,
    );
  }

  for (const chunk of value.split(';')) {
    if (!chunk.trim()) continue;
    const [rawAxis, rawNumber] = chunk.split(':');
    const axis = rawAxis?.trim() ?? '';
    const index = axes.indexOf(axis as (typeof AXES)[number]);
    if (index === -1) {
      // `0.6; y: 1.2; z: 0.8` — one axis left unnamed. Give it the axis nobody named, and hand
      // back the result, but only when that result is a whole, valid axis form.
      const repaired = nameMissingAxes(value, axes);
      return at(
        'bad-vector',
        `${prop.name}="${text}" names axis "${axis}"; this value has ${axes.join(', ')}.`,
        repaired ? [{ value: repaired }] : [],
      );
    }
    const number = Number(rawNumber?.trim());
    if (!Number.isFinite(number)) {
      return at('bad-vector', `${prop.name}="${text}" has a non-numeric value for "${axis}".`);
    }
    parts[index] = number;
  }

  const type = `Vector${arity}` as const;
  const local = context.require('three', type);
  return { code: `new ${local}(${parts.join(', ')})`, diagnostics: [] };
}

const AXES = ['x', 'y', 'z', 'w'] as const;

/** `"1 2 3"` → `"x: 1; y: 2; z: 3"`, or undefined when it is not a plain list of numbers. */
function asAxisForm(value: string, arity: number): string | undefined {
  const numbers = value.split(/[\s,;]+/).filter(Boolean);
  if (numbers.length === 0 || numbers.length > arity) return undefined;
  if (numbers.some((n) => !Number.isFinite(Number(n)))) return undefined;
  return numbers.map((n, index) => `${AXES[index]}: ${n}`).join('; ');
}

/**
 * A member of a literal union.
 *
 * Two kinds arrive here. A string union (`'static' | 'dynamic'`) authors as its own text and
 * emits as a quoted literal. A numeric one is three.js's constant idiom — `type Side = 0|1|2`
 * with `declare const FrontSide: 0` — so the document names the *constant*, which is imported
 * and emitted by name. `side="FrontSide"` therefore reads in the generated code, where `0`
 * would not.
 */
function emitEnum(prop: PropInfo, text: string, context: EmitContext, at: Fail): Emitted {
  const value = text.trim();
  const options = prop.options ?? [];
  const quoted = options.map((o) => o.replace(/^["']|["']$/g, ''));

  const index = quoted.indexOf(value);
  if (index !== -1 && options[index]!.startsWith('"')) {
    return { code: quote(value), diagnostics: [] };
  }
  // A union of three.js constants: the document names the constant and the emitter imports it.
  // The names are known — read off the alias's declaration — so a near miss is answered here
  // rather than by `tsc` in generated code.
  const named = options.length > 0 && options.every((o) => /^[A-Z][A-Za-z0-9_]*$/.test(o));
  if (named && options.includes(value)) {
    return { code: context.require('three', value), diagnostics: [] };
  }
  if (!named && /^[A-Z][A-Za-z0-9_]*$/.test(value)) {
    // Nothing recovered the names — the union is not the `typeof CONSTANT` idiom — so a
    // capitalised word is taken at its word and `tsc` has the last one.
    return { code: context.require('three', value), diagnostics: [] };
  }
  const near = nearestName(value, quoted);
  return at(
    'bad-enum',
    `${prop.name}="${text}" is not one of ${quoted.join(', ') || 'the accepted constants'}.` +
      (near ? ` Did you mean ${near}?` : ''),
  );
}

/** `[a, b, c]` — bracketed, comma-separated, each entry emitted as the element shape. */
function emitArray(
  prop: PropInfo,
  text: string,
  element: SncElement,
  context: EmitContext,
  at: Fail,
): Emitted {
  const value = text.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) {
    // The list itself is often right and only the brackets are missing — but `curve="0 1, 1 0"`
    // bracketed is still wrong, and then what one entry is says more than the brackets.
    return at(
      'bad-array',
      `${prop.name}="${text}" must be bracketed.`,
      [{ value: `[${value}]` }],
      ` It is a list, each entry ${describeEntry(prop)}, as ${prop.name}="[${exampleEntries(prop)}]".`,
    );
  }
  const inner = value.slice(1, -1).trim();
  if (inner === '') return { code: '[]', diagnostics: [] };

  const elementProp: PropInfo = {
    ...prop,
    shape: prop.elementShape ?? ('unsupported' as ValueShape),
    ...(prop.elementShape === 'enum' && prop.options ? { options: prop.options } : {}),
    // A list of a union type — `(Color | Texture)[]` — keeps the alternatives, so each entry
    // is read the same way a lone value of that type would be.
    ...(prop.elementShape === 'union' && prop.shapes ? { shapes: prop.shapes } : {}),
  };
  const diagnostics: SncDiagnostic[] = [];
  const codes: string[] = [];
  for (const entry of inner.split(',')) {
    const emitted = emitValue(elementProp, entry.trim(), element, context);
    diagnostics.push(...emitted.diagnostics);
    if (emitted.code) codes.push(emitted.code);
  }
  if (diagnostics.length > 0) return { diagnostics };
  return { code: `[${codes.join(', ')}]`, diagnostics: [] };
}

/**
 * A value whose type admits several shapes — the text says which one it is.
 *
 * `Scene.background` is declared `Color | Texture | CubeTexture | null`, and a document has to
 * be able to write both `background="#05070d"` and `background="stars.png"`. Reducing that to
 * one shape would drop half of it; refusing it — which is what happened before this existed —
 * dropped all of it, silently, because an unsupported property is simply not offered as an
 * attribute.
 *
 * The alternatives are tried in a fixed order of specificity, never in the order the union
 * happens to be declared in, so the same text always means the same thing. Each shape's
 * matcher is deliberately narrow: a colour is `#` plus three or six hex digits, an asset is a
 * path with an extension, and `string` — which accepts anything — is always last.
 */
function emitUnion(
  prop: PropInfo,
  text: string,
  element: SncElement,
  context: EmitContext,
  at: Fail,
): Emitted {
  const alternatives = prop.shapes ?? [];
  for (const shape of UNION_ORDER) {
    if (!alternatives.includes(shape)) continue;
    if (!matchesShape(shape, text, prop)) continue;
    return emitValue({ ...prop, shape }, text, element, context);
  }
  return at(
    'bad-union',
    `${prop.name}="${text}" is not one of the forms ${prop.name} takes (${prop.type}). ` +
      `Write it as ${alternatives.map(describeShape).filter(Boolean).join(', or ')}.`,
  );
}

/** Most specific first. `string` accepts anything, so it can only ever be the last resort. */
const UNION_ORDER: readonly ValueShape[] = [
  'array',
  'boolean',
  'vector2',
  'vector3',
  'vector4',
  'euler',
  'nodeRef',
  'color',
  'assetRef',
  'enum',
  'number',
  'string',
];

/** Whether this text could be a value of that shape. Syntax only — nothing is resolved here. */
function matchesShape(shape: ValueShape, text: string, prop: PropInfo): boolean {
  const value = text.trim();
  switch (shape) {
    case 'array':
      return value.startsWith('[');
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'number':
      return Number.isFinite(Number(value)) || asHex(value) !== undefined;
    case 'color':
      return asHex(value) !== undefined;
    case 'vector2':
    case 'vector3':
    case 'vector4':
    case 'euler':
      return value.includes(':');
    case 'nodeRef':
      return value.startsWith('#');
    case 'assetRef':
      return /\.[A-Za-z0-9]+$/.test(value);
    case 'enum':
      return (prop.options ?? []).some((o) => o.replace(/^["']|["']$/g, '') === value);
    case 'string':
      return true;
    default:
      return false;
  }
}

/** How to write a value of this shape, for the diagnostic that lists the alternatives. */
function describeShape(shape: ValueShape): string {
  switch (shape) {
    case 'color':
      return 'a hex colour ("#38bdf8")';
    case 'assetRef':
      return 'a path to an asset ("stars.png")';
    case 'nodeRef':
      return 'a reference to a node ("#id")';
    case 'number':
      return 'a number';
    case 'boolean':
      return '"true" or "false"';
    case 'string':
      return 'text';
    case 'vector2':
    case 'vector3':
    case 'vector4':
    case 'euler':
      return 'an axis-named vector ("x: 1; y: 2")';
    case 'enum':
      return 'one of its constants';
    case 'array':
      return 'a bracketed list';
    default:
      return '';
  }
}

/** A single-quoted TypeScript string literal. */
export function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** What one entry of a list field is, in words. */
function describeEntry(prop: PropInfo): string {
  switch (prop.elementShape) {
    case 'number': return 'a number';
    case 'color': return 'a #rrggbb colour';
    case 'vector3': return 'an x: …; y: …; z: … vector';
    case 'nodeRef': return 'a #id';
    case 'string': return 'a word';
    default: return `a ${prop.elementShape ?? 'value'}`;
  }
}

/** Two sample entries of a list field, in its own spelling. */
export function exampleEntries(prop: PropInfo): string {
  switch (prop.elementShape) {
    case 'number': return '1, 0.5, 0';
    case 'color': return '#ff8800, #ffffff';
    case 'vector3': return 'x: 1; z: 2, x: -1; z: 2';
    case 'nodeRef': return '#a, #b';
    default: return '…, …';
  }
}

/**
 * A rewrite as it is written back: the whole attribute for a value of its own, the entry alone
 * for one entry of a list — `colors="[red, blue]"` is fixed entry by entry, and handing back
 * `colors="#ff0000"` would drop the rest of the list and the brackets with it.
 */
function spelled(prop: PropInfo, rewrite: Rewrite): string {
  const own = isEntry(prop) ? rewrite.value : `${prop.name}="${rewrite.value}"`;
  return [own, ...(rewrite.also ?? []).map(([name, value]) => `${name}="${value}"`)].join(' ');
}

/**
 * `0.6; y: 1.2; z: 0.8` → `x: 0.6; y: 1.2; z: 0.8`: bare values take the axes nobody named, in
 * order. Only the spelling — whether the result is a valid vector is the rewrite check's to say.
 */
function nameMissingAxes(value: string, axes: readonly string[]): string | undefined {
  const chunks = value.split(';').map((chunk) => chunk.trim()).filter(Boolean);
  const named = chunks.filter((chunk) => chunk.includes(':')).map((chunk) => chunk.split(':')[0]!.trim());
  const free = axes.filter((axis) => !named.includes(axis));
  let given = 0;
  const written = chunks.map((chunk) => (chunk.includes(':') ? chunk : `${free[given++]}: ${chunk}`));
  return given > 0 && given <= free.length ? written.join('; ') : undefined;
}

