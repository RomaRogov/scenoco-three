/**
 * Where each element was written, and with what — what the editor goes by to find a picked object's
 * tag, put a reset value back, and call a prefab again; and what an export reads to keep a nested
 * prefab nested. Recorded by `jsx` (which function made a node) and, in development, by `jsxDEV`.
 */

type Props = Record<string, unknown>;

/**
 * Which function made a node, and with what, so an export can keep `<ArrowBase />` a nested prefab
 * rather than copy what it built, and the editor can call it again.
 */
/** @internal */
export function remember(made: unknown, type: Function, all: Props): void {
  if (!made || typeof made !== 'object') return;
  const { children: _c, key: _k, ...given } = all;
  madeBy.set(made, { prefab: type as () => unknown, given: Object.keys(given).length > 0, props: all });
}

/**
 * The prefab function whose element made a node, whether that element passed it attributes, and
 * the props it was called with — what the editor calls it with again when one of them changes.
 */
interface MadeBy {
  prefab: () => unknown;
  given: boolean;
  props: Props;
}
const madeBy = new WeakMap<object, MadeBy>();

/** @internal What an export reads: the prefab that made `node`, if a `<Prefab />` element did. */
export function prefabOf(node: object): MadeBy | undefined {
  return madeBy.get(node);
}

// --- development records ---------------------------------------------------------------------

/** Where an element was written: what `jsxDEV` is told in development, 1-based, at the `<`. */
export interface Source {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}
const sources = new WeakMap<object, Source>();

/**
 * Where the element that made this object — a node, a material, a behaviour — was written. Development
 * builds only: what lets an editor go from a picked object to its tag.
 */
export function sourceOf(made: object): Source | undefined {
  return sources.get(made);
}

/**
 * The attributes the element that made this object was written with — what the editor puts back
 * when a value is reset. Development builds only.
 */
export function givenOf(made: object): Readonly<Record<string, unknown>> | undefined {
  return given.get(made);
}

/** @internal what the editor wrote into an element: the next reset puts this back. */
export function setGiven(made: object, name: string, value: unknown): void {
  given.set(made, { ...given.get(made), [name]: value });
}

/** @internal an object made again by the editor still stands for what the file says, not what made it again. */
export function keepGiven(from: object, to: object): void {
  const was = given.get(from);
  if (was) given.set(to, was);
  const inner = own.get(from);
  if (inner) own.set(to, inner);
}

const given = new WeakMap<object, Record<string, unknown>>();

/**
 * A node a function's tag made — a prefab's root — is its tag's, as far as `sourceOf` and `givenOf`
 * say: the tag places it. Its own element, inside the function, is what this answers: where it is
 * written and with what — the prefab's own, which the tag overrides. Development builds only.
 */
export function ownOf(made: object): { source?: Source; given?: Readonly<Record<string, unknown>> } | undefined {
  return own.get(made);
}

const own = new WeakMap<object, { source?: Source; given?: Record<string, unknown> }>();

/**
 * @internal What `jsxDEV` saw: where `made` was written and with which attributes. `byFunction` when a
 * function's tag made it — that tag takes the root over, so what the root's own element said is kept apart first.
 */
export function record(made: unknown, props: Props | null, source: Source | undefined, byFunction: boolean): void {
  if (!made || typeof made !== 'object' || Array.isArray(made)) return;
  if (byFunction && sources.has(made) && !own.has(made)) {
    own.set(made, { source: sources.get(made), given: given.get(made) });
  }
  if (source) sources.set(made, source);
  const { children: _c, key: _k, ref: _r, ...attributes } = props ?? {};
  given.set(made, attributes);
}

/** @internal A behaviour stands for the tag that made it: where that was written, and what it gave. */
export function handOver(tag: object, behaviour: object, init: Record<string, unknown>): void {
  const source = sources.get(tag);
  if (source) sources.set(behaviour, source);
  if (given.has(tag)) given.set(behaviour, init);
}
