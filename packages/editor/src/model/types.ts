/**
 * What the interface draws: a node as its tags, each attribute a line — and the few words for where
 * a value is written. Plain data; `Model` makes it, the interface only reads it.
 */
import type { Object3D } from 'three';

/** A value the editor can edit, by what it is live. */
export type Kind = 'number' | 'boolean' | 'string' | 'color' | 'vector' | 'list' | 'angles' | 'option';

/** What the project's TypeScript declares a field or an argument to be: from the dev server. */
export type Field = { kind: Exclude<Kind, 'option'> } | { kind: 'option'; options: Option[] };

/** One of a few values a field takes, and how the file writes it: `"world"`, `{DoubleSide}`. */
export interface Option {
  label: string;
  value: string | number;
  text: string;
  /** A constant the file must import to write it. */
  import?: { name: string; from: string };
}

/** One attribute, as a line of the TSX. */
export interface Attr {
  name: string;
  /** The value shown and edited: degrees for angles, `#rrggbb` for a colour. */
  value: unknown;
  /** Absent: shown as its source text, not edited. */
  kind?: Kind;
  /** For an `option`: the values it takes. */
  options?: Option[];
  /** Whether the element writes it. */
  written: boolean;
  /** The attribute's text in the file — `{[0, 1, 0]}`, `"wall"` — null for a bare flag. */
  text: string | null;
  /** Why a change stays live and is not written, when it is not. */
  liveOnly?: string;
  /** Changed since the last save: Save writes it. */
  unsaved: boolean;
  /** What the file says, as the editor shows it, when it writes a value the editor can compare. */
  file?: unknown;
  /**
   * What Reset puts back, only while the live value has moved away from it: what the file says, or —
   * for a change the file does not write — the value before the change.
   */
  source?: unknown;
  /** What it sets: the node, a behaviour, or — for a prop of a function's tag — the node it made. */
  target: object;
  /** A prop of a function's tag: setting it calls the function again, written or not. */
  prop?: boolean;
  /** Where a change is written: its element in its file. Absent for one that stays live, or is locked. */
  at?: Address;
  /** Shown, not edited: what a prefab is made of, outside prefab mode. */
  locked?: boolean;
  /** Every object the same element made — every copy of the prefab — takes a change. */
  wide?: boolean;
  /** The element, as `file:line:column`: what finds its other copies. */
  element?: string;
  /** One of the element's `args`, shown on its own line and named for the constructor's parameter. */
  arg?: ArgPlace;
  /** A list written in place, `[a, b]`: each item's text, which places a name in it on its item. */
  items?: string[];
  /** Each name in its text — `terrains`, `meadow` in `{terrains.meadow}` — and where it is declared. */
  links?: TextLink[];
}

/** A name in an attribute's text, `from` to `to`, and where the project declares it. */
export interface TextLink {
  from: number;
  to: number;
  where: Where;
}

/** Where an argument stands: its index, the list now, and the list's texts as the file writes them. */
export interface ArgPlace {
  index: number;
  now: Args;
  /** Each item's text when the page loaded: what a value put back is written as again. */
  original: string[];
  /** The whole attribute's text when the page loaded. */
  whole: string | null;
}

/** An element's arguments as they stand: the values the live object was made with, and their texts. */
export interface Args {
  list: unknown[];
  items: string[];
}

/** The prefab being edited in prefab mode, and how many copies of it the scene has. */
export interface Stage {
  root: Object3D;
  name: string;
  file: string;
  count: number;
}

/** One tag of the TSX: a node's element or a behaviour's. */
export interface Tag {
  name: string;
  attrs: Attr[];
  /** `Arena.tsx:37`, and where the code editor opens. */
  where?: Where;
}

/** A place in a project file. */
export interface Where {
  label: string;
  file: string;
  line: number;
  col: number;
}

/** How a source link opens: through the dev server — guessed, the system's app, the project's command — or an editor's own URL. */
export type CodeEditor = 'auto' | 'system' | 'custom' | 'vscode' | 'cursor';

export interface View {
  tag: Tag;
  /** What its element's children made and it holds — `<PlaneGeometry>`, `<Fog attach="fog">`. */
  attached: Tag[];
  behaviours: Tag[];
  /** Why nothing here is written, when nothing is. */
  note?: string;
  /** A prefab's copy: under its tag's overrides, what the prefab itself says — read-only here. */
  prefab?: { name: string; where?: Where; own: Tag; behaviours: Tag[]; root: Object3D };
  /** The prefab this node is a part of, to edit in prefab mode. */
  enter?: { root: Object3D; name: string };
  /** What to write instead, when the note is a refusal with a way out. */
  advice?: string;
}

/** Where an element is in its file: by index in document order, which an attribute edit never changes. */
export interface Address {
  file: string;
  index: number;
}
