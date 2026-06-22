// `@scenoco-three/core` — the runtime entry point. Contains no XML parser,
// validator, or compiler: it loads pre-built bundles only.

export { Engine, type EngineOptions, type SceneGraph } from './core/Engine.js';
export { Component } from './core/Component.js';
export { System } from './core/System.js';
export {
  InputManager,
  type KeyCode,
  type GamepadButton,
  type GamepadState,
} from './core/Input.js';
export {
  Registry,
  isScalarType,
  isArrayType,
  elementType,
  type PropType,
  type PropertyType,
  type PropertyMeta,
  type ComponentMeta,
  type ComponentCtor,
  type RegisteredComponent,
} from './core/Registry.js';
export { enumOf, isEnumType, getEnum, allEnums, type EnumDef } from './core/EnumRegistry.js';

// One authoring idiom: @property fields + a class decorator per role.
export {
  component,
  property,
  node,
  attachment,
  system,
  executeInEditor,
  type ComponentOptions,
  type NodeOptions,
  type AttachmentOptions,
} from './core/decorators.js';
export { Object3DNode, Attachment } from './nodes/base.js';

// Tag registry — built-in tags self-register on import; projects add their own
// the same way (the extensible counterpart to @component).
export {
  getNodeDef,
  nodeTags,
  allNodeDefs,
  registerNode,
  unregisterNode,
  getAttachmentDef,
  attachmentTags,
  allAttachmentDefs,
  registerAttachment,
  unregisterAttachment,
  type NodeDef,
  type NodeAttr,
  type NodeKind,
  type ChildRules,
  type AttachmentDef,
  type AttachTarget,
  type AttachContext,
} from './dsl/nodes.js';

// Bundle: the optimized format the runtime loads.
export { deserializeBundle } from './dsl/deserialize.js';
export {
  BUNDLE_VERSION,
  bundleKind,
  type Bundle,
  type BundleAsset,
  type BundleKind,
} from './dsl/bundle-format.js';
export { instantiateScene, type InstantiatedScene } from './dsl/instantiate.js';
export { PrefabRef, type SpawnOptions, type SpawnFn } from './dsl/PrefabRef.js';
export type {
  CompiledScene,
  CompiledNode,
  CompiledComponent,
  CompiledAsset,
  CompiledRef,
  CompiledValue,
  CompiledTransform,
} from './dsl/compiled.js';

