// Build-time half of SceNoCo. It never runs game code: everything it knows about a project
// comes from reading its TypeScript source with the compiler API.
export { Workspace } from './scan/workspace.js';
export { scanComponents, scanEffects, scanSystems } from './scan/components.js';
export { scanTags } from './scan/tags.js';
export { scanProject } from './scan/project.js';
export { scanConfigShape, type ConfigShape } from './scan/interfaces.js';
export type {
  ComponentInfo,
  PropInfo,
  ProjectModel,
  SerializedField,
  TagFamily,
  TagInfo,
  ValueShape,
} from './model.js';
export { parseDocument, type SncElement, type ParseResult } from './dsl/parse.js';
export { formatDiagnostic, nearestName, type SncDiagnostic } from './dsl/diagnostics.js';
export { emitValue, type EmitContext } from './dsl/value.js';
// Editing a document as text, addressed by the same position provenance stamps.
export {
  elementAt,
  indexDocument,
  insertChild,
  moveElement,
  removeElement,
  setAttribute,
  type EditResult,
  type ElementAt,
  type ElementRange,
} from './dsl/edit.js';
export {
  emitGraph,
  emitRender,
  emitResource,
  RENDER_ROOT,
  TsModule,
  camelCase,
  pascalCase,
  type AssetImport,
  type GraphOptions,
} from './emit/index.js';
export {
  emitConfigDocument,
  type ConfigDocumentOptions,
  type ModuleBinding,
} from './emit/index.js';
export { PARTICLE_MODULES, PARTICLE_CONFIG } from './particles.js';
export { build, formatDiagnostics, type BuildOptions, type BuildResult } from './build.js';
export { templateFor } from './templates.js';
export { run as runCli } from './cli.js';
export { ASSET_KINDS, ASSET_TYPES, FILE_KINDS, detectTagPackages, fileKindOf, findAssets, outputPathFor, type AssetFile, type AssetKind } from './assets.js';
