/**
 * `@scenoco-three/compiler/browser` — the parts of the compiler a page can run.
 *
 * The compiler proper reads a TypeScript workspace, which is a Node program. But its parser,
 * its element index and its comment-preserving edit splices are plain JavaScript over the
 * document text, and the standalone editor needs exactly those: to open an XML it was handed by
 * URL or from disk, to address elements the same way provenance does, and to save a change back
 * into the text the way the server does. One implementation, reached from both sides, is what
 * keeps the two from disagreeing about a position.
 */
export { parseDocument, type ParseResult, type SncElement } from './dsl/parse.js';
export {
  indexDocument,
  insertChild,
  moveElement,
  removeElement,
  setAttribute,
  type ElementAt,
  type ElementRange,
} from './dsl/edit.js';
export type { SncDiagnostic } from './dsl/diagnostics.js';
export type {
  ComponentInfo,
  DocumentKindInfo,
  DocumentShape,
  ModuleInfo,
  ProjectModel,
  PropInfo,
  SerializedField,
  TagFamily,
  TagInfo,
  ValueShape,
} from './model.js';
export { MODEL_FILE, PREVIEW_THREE } from './model.js';
export { defaultAxes } from './dsl/axes.js';
export { PLACEMENT } from './emit/placement.js';
