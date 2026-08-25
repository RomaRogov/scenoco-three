// `Symbol.metadata` is a stage-3 addition that Node 22 does not ship. Without it
// every `context.metadata` is `undefined` and the first decorator throws, so the
// polyfill has to run before any decorated class is evaluated — i.e. here, in the
// module that defines the decorators.
(Symbol as { metadata?: symbol }).metadata ??= Symbol('Symbol.metadata');

/**
 * The authoring model, Unity's:
 *
 * ```ts
 * export class PaddleController extends Component<Mesh> {
 *   /** Units per second the paddle travels. *␀/
 *   speed = 10;
 *   private velocity = 0;
 * }
 * ```
 *
 * **A component needs no decorators at all.** It is a class extending
 * `Component`, and that is the whole registration — the build scans the
 * workspace for those classes, so there is no tag to declare, no name to keep
 * unique, and no registry to import into. Its **public fields are serialized**;
 * private ones are not, exactly as `[SerializeField]`/`public` work in Unity.
 *
 * The build reads all of it from the source with the TypeScript API: the field's
 * type from its annotation, its default from the initializer, its description
 * from the doc comment, and its visibility from the `private` modifier. Nothing
 * is restated in a decorator, so nothing can disagree with the code.
 *
 * The two decorators below exist only for the things the source genuinely cannot
 * say on its own.
 */

/** Extra facts about a serialized field that its type cannot express. */
export interface SerializeOptions {
  /**
   * Marks a `string` field as an asset reference, so tooling offers a picker and
   * the build can enumerate what a scene needs.
   */
  asset?: 'texture' | 'model' | 'audio';
  /**
   * The characters a string field can actually render, for a field whose value
   * reaches a renderer with a fixed glyph set (an MSDF font atlas). Anything
   * outside it is a build-time diagnostic naming the character.
   */
  charset?: string;
}

/** One class's explicitly-marked fields: field name → the options it declared. */
export type SerializedBag = Record<string, SerializeOptions>;

interface ScenocoMetadata {
  serialized?: SerializedBag;
}

/**
 * This class's **own** bag, prototype-chained onto its base's.
 *
 * `context.metadata` for a subclass is a fresh object whose prototype is the
 * base class's metadata, so inherited entries are readable for free. But that
 * also means the obvious `metadata.serialized ??= {}` resolves *through* the
 * prototype and mutates the **base's** bag — a subclass's fields then appear in
 * its parent's schema, and every sibling inherits them. The own-property guard
 * is what keeps each class writing only to itself.
 */
function ownBag(metadata: ScenocoMetadata): SerializedBag {
  if (!Object.hasOwn(metadata, 'serialized')) {
    Object.defineProperty(metadata, 'serialized', {
      value: Object.create(metadata.serialized ?? null) as SerializedBag,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return metadata.serialized!;
}

/**
 * Fields a class marked with {@link serialize}, own and inherited.
 *
 * This is **not** the serialized set — public fields are serialized without any
 * decorator, and the build knows them from the source. It is only what `@serialize`
 * explicitly annotated, which is all the runtime can see.
 */
export function serializedFieldsOf(ctor: abstract new (...args: never[]) => unknown): SerializedBag {
  const bag = (ctor as { [Symbol.metadata]?: ScenocoMetadata })[Symbol.metadata]?.serialized;
  if (!bag) return {};
  // `for…in` walks the prototype chain, which is exactly the inheritance we want.
  const out: SerializedBag = {};
  for (const key in bag) out[key] = bag[key]!;
  return out;
}

type FieldDecorator<V> = (value: undefined, context: ClassFieldDecoratorContext<unknown, V>) => void;

/**
 * Serialize a field the build would otherwise skip, or annotate one it already
 * takes — Unity's `[SerializeField]`.
 *
 * Public fields need none of this; they are serialized because they are public.
 * Reach for it in two cases:
 *
 * ```ts
 * ␀serialize private tuning = 0.5;              // keep it out of the API, keep it authored
 * ␀serialize({ asset: 'texture' }) skin = '';   // a fact `string` cannot carry
 * ```
 */
export function serialize<V>(value: undefined, context: ClassFieldDecoratorContext<unknown, V>): void;
export function serialize<V>(options?: SerializeOptions): FieldDecorator<V>;
export function serialize<V>(
  a?: SerializeOptions | undefined,
  b?: ClassFieldDecoratorContext<unknown, V>,
): void | FieldDecorator<V> {
  // Bare `@serialize` — TypeScript calls the decorator itself, with the context.
  if (b !== undefined) return mark(b, {});
  // `@serialize({ … })` — a factory, so give back the decorator.
  const options = a ?? {};
  return (_value, context) => mark(context, options);
}

function mark<V>(context: ClassFieldDecoratorContext<unknown, V>, options: SerializeOptions): void {
  if (typeof context.name === 'symbol') {
    throw new Error('@serialize fields must have string (non-symbol) names');
  }
  if (context.static) {
    throw new Error(`@serialize cannot decorate the static field "${context.name}"`);
  }
  ownBag(context.metadata as ScenocoMetadata)[context.name] = options;
}
