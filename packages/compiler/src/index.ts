// `@scenoco-three/compiler` — the BUILD-TIME entry point: XML → validated → CompiledScene
// → optimized Bundle, plus the XSD/docs exporters. This is where the XML parser
// (saxes), validator, and compiler live; it never ships to the browser runtime.
//
// Build-time tooling needs the full built-in node set registered so validation,
// compilation and exporters see every tag. The runtime entry no longer pulls in
// node modules (for tree-shaking), so the compiler imports the barrel explicitly.
// This is the Node process only; it never reaches the browser bundle.
import '@scenoco-three/core/nodes';

export { parseScene, type SncElement as SceElement, type ParseResult } from './dsl/SceneParser.js';
export { validateScene } from './dsl/Validator.js';
export {
  compileSceneXml,
  compilePrefabXml,
  type CompileResult,
  type CompileOptions,
  type ResourceResolver,
  type ResolvedFile,
} from './dsl/compile.js';
export { bundleScene, bundlePrefab } from './dsl/bundle.js';
export { serializeScene } from './dsl/serialize.js';
export { patchSceneXml, type PatchEdit, type PatchTarget, type PatchResult } from './dsl/patch.js';
export { parseUniforms, glslMatches } from './dsl/shader.js';
export type { NodeOrigin, SceneProvenance } from './dsl/provenance.js';
export {
  watchSceneFiles,
  type WatchOptions,
  type WatchHandle,
  type WatchEvent,
} from './watch.js';
export { scanComponents, loadComponents, detectTagPackages, collectedPackageSchemas, componentLoadError, type ComponentScan, type LoadOptions, type SchemaFile, type ComponentLoadError } from './components.js';
export { scaffoldFiles } from './cli/templates.js';

// Built-in node tag → package subpath that registers it, for usage-based shipping.
export { builtinNodeModules, builtinNodeModule } from '@scenoco-three/core/internal';

// Asset enumeration — the Vite plugin uses it to rewrite asset URLs to bundler-served assets.
export { collectAssetRefs, type AssetRef } from '@scenoco-three/core';

export { generateXsd, generateMaterialXsd, generatePrefabXsd } from './exporters/xsd.js';
export {
  generateApi,
  generateApiJson,
  type SceneApi,
  type NodeApi,
  type AttachmentApi,
  type ComponentApi,
  type SystemApi,
  type PropertyApi,
  type Attribute,
  type ReferenceTarget,
  type Relation,
  type EntityRef,
  type AttachmentGroupRef,
} from './exporters/api.js';

export { formatDiagnostic, type SncDiagnostic as SceDiagnostic } from './dsl/diagnostics.js';
export { codecs, parseArrayLiteral, parseScalarArray, serializeScalarArray, type ScalarType, type TypeCodec } from './dsl/types.js';

// Re-export the data types tooling produces, for convenience.
export type {
  CompiledScene,
  CompiledNode,
  CompiledComponent,
  CompiledAsset,
  CompiledRef,
  CompiledValue,
  Bundle,
} from '@scenoco-three/core/internal';
