/**
 * Markers the build reads from a component's source. Neither does anything when it runs, and
 * neither gets the chance: `scenoco()` removes both, and the import that brought them, before the
 * code reaches the page — a decorator is syntax no browser parses yet, and these have no job
 * there. What they say is checked by the build instead, as a diagnostic on the class.
 *
 * Read by name, like every other fact the scan takes from the source, so they only work as
 * written here: decorating a field in a *package* does nothing, because a declaration file does
 * not keep decorators. A package keeps state out of documents the way a declaration file can see
 * — a getter.
 */

/** Serialize a private field the build would otherwise skip — Unity's `[SerializeField]`. */
export function serializeField(_value: undefined, _context: ClassFieldDecoratorContext): void {}

/**
 * Keep a public field out of documents and the editor — Unity's `[NonSerialized]`. Writing it as
 * an attribute is a build error that names this marker.
 */
export function nonSerialized(_value: undefined, _context: ClassFieldDecoratorContext): void {}
