/** Marks a private field as an authorable attribute in the DSL. Public fields need no mark. */
export function serializeField<V>(
  _value: undefined,
  context: ClassFieldDecoratorContext<unknown, V>,
): void {
  if (typeof context.name === 'symbol') {
    throw new Error('@serializeField fields must have string (non-symbol) names');
  }
  if (context.static) {
    throw new Error(`@serializeField cannot decorate the static field "${context.name}"`);
  }
}
