/**
 * Every character the bundled MSDF font can draw.
 *
 * uikit renders text from a signed-distance-field *atlas*, not a vector font, so
 * it can only draw glyphs that were baked in. `@pmndrs/msdfonts/inter` — the
 * default family, and the only one a project gets without shipping its own —
 * bakes **104**: ASCII plus `°`, `§`, and the German umlauts/eszett. No em-dash,
 * no ellipsis, no curly quotes, no `×`, no other accented letter.
 *
 * A character outside the set draws an empty box and reports itself in a runtime
 * `console.warn`, which is not where anyone is looking while writing a scene. So
 * the set is declared on `<Text>`'s `text` property (see `PropertyMeta.charset`)
 * and `scenoco validate` names the offending character instead.
 *
 * Identical across all four bundled weights (light/medium/semi-bold/bold), which
 * is why one constant covers the family. It is transcribed rather than read from
 * the font, because a `@property` decorator runs synchronously and the font
 * arrives through a dynamic `import()` — `tests/packages/ui.test.ts` compares the
 * two, so the copy cannot quietly go stale.
 */
export const INTER_MSDF_CHARSET =
  ' °!\\"#$%&\'()*+,-./0123456789:;<=>?@ÄÖÜABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`äöüabcdefghijklmnopqrstuvwxyz{|}~ß§';
