import { Color, Euler, type Object3D, Vector2, Vector3 } from 'three';
import type { AssetCache } from '../core/AssetCache.js';
import type { Component } from '../core/Component.js';
import { Registry, isArrayType, elementType, type PropType, type PropertyMeta } from '../core/Registry.js';
import type { EnumDef } from '../core/EnumRegistry.js';
import type { CompiledComponent, CompiledNode, CompiledRef, CompiledScene, CompiledValue } from './compiled.js';
import type { CompiledScalar } from './types.js';
import { getAttachmentDef, getNodeDef, type AttachmentInstance } from './nodes.js';
import { PrefabRef, type SpawnFn } from './PrefabRef.js';

/**
 * The live result of instantiating a CompiledScene: a Three.js subtree, bare
 * component instances (lifecycle not yet started — the Engine owns that), and
 * the live attachment instances (which the engine retains for `findAttachment`).
 * Arrays are index-aligned with the CompiledScene so references resolve by index.
 */
export interface InstantiatedScene {
  /** Object for the root <Scene> node; its children are the scene contents. */
  root: Object3D;
  /** Live objects, index-aligned with CompiledScene.nodes (tooling maps live → source). */
  nodes: Object3D[];
  /** Index-aligned with CompiledScene.components. */
  components: { instance: Component; node: Object3D }[];
  /** One per pooled attachment (caching → shared geometry/material). */
  attachments: AttachmentInstance[];
}

/** Context for instantiation — how a `prefab` prop spawns its subtree. */
export interface InstantiateContext {
  /**
   * How a `prefab` prop spawns its subtree (the Engine passes `engine.instantiate`).
   * Absent when instantiating standalone (pure tests) — a PrefabRef.spawn() then
   * throws a clear error rather than silently no-op.
   */
  spawn?: SpawnFn;
  /** Loaded assets, passed to each attachment's `attach(ctx.assets)`. */
  assets?: AssetCache;
}

/**
 * Build live Three.js objects, attachments, and component instances from a
 * compiled scene. Attachments are pooled (one instance per entry → shared
 * resources); component references are wired by index in a second pass, so they
 * are valid before any component lifecycle runs.
 */
export function instantiateScene(compiled: CompiledScene, ctx: InstantiateContext = {}): InstantiatedScene {
  // One instance per pooled attachment entry, so caching shares the resource.
  const attachments = compiled.attachments.map((a) => getAttachmentDef(a.tag)!.make(a.attrs, a.uniforms));
  const objects: Object3D[] = compiled.nodes.map((node) => buildObject(node));

  // Link the scene graph.
  compiled.nodes.forEach((node, i) => {
    for (const childIndex of node.children) objects[i]!.add(objects[childIndex]!);
  });

  // Apply attachments — each configures its host node directly (geometry/material
  // on a mesh, fog/background on the Scene, which is itself a node here).
  compiled.nodes.forEach((node, i) => {
    for (const ai of node.attachments) attachments[ai]!.attach({ node: objects[i]!, assets: ctx.assets });
  });

  // Create component instances and set their scalar props (refs come next).
  const instances: Component[] = compiled.components.map((c) => {
    const entry = Registry.getComponent(c.type)!;
    const instance = new entry.ctor();
    instance.node = objects[c.node]!;
    if (c.id !== undefined) instance.id = c.id;
    setScalarProps(instance, c, entry.meta.properties);
    // Hand a `src=` document's compiled config to the component before onLoad.
    if (c.config !== undefined) instance.applyConfig?.(c.config);
    return instance;
  });

  // Wire references now that every object and instance exists.
  const spawn: SpawnFn = ctx.spawn ?? unboundSpawn;
  compiled.components.forEach((c, i) => {
    const props = Registry.getComponent(c.type)!.meta.properties;
    const ownerNode = instances[i]!.node;
    const resolveRef = (ref: CompiledRef): unknown => {
      if ('prefab' in ref) return new PrefabRef(compiled.prefabs![ref.prefab]!, spawn, ownerNode);
      return 'node' in ref ? objects[ref.node] : instances[ref.component];
    };
    for (const [attr, value] of Object.entries(c.props)) {
      const meta = props.get(attr);
      if (!meta || !isReferenceType(elementType(meta.type))) continue;
      const target = instances[i] as unknown as Record<string, unknown>;
      target[attr] = isArrayType(meta.type)
        ? (value as CompiledRef[]).map(resolveRef)
        : resolveRef(value as CompiledRef);
    }
  });

  return {
    root: objects[compiled.root]!,
    nodes: objects,
    components: instances.map((instance, i) => ({ instance, node: objects[compiled.components[i]!.node]! })),
    attachments,
  };
}

function buildObject(node: CompiledNode): Object3D {
  const object = getNodeDef(node.tag)!.build(node.attrs);
  // The DSL `id` maps to Three.js's Object3D.name (Object3D.id is a reserved
  // numeric auto-id), so name-based lookups keep working.
  if (node.id !== undefined) object.name = node.id;

  const { position, rotation, scale, visible } = node.transform;
  object.position.fromArray(position);
  object.rotation.set(rotation[0]!, rotation[1]!, rotation[2]!);
  object.scale.fromArray(scale);
  object.visible = visible;
  return object;
}

function setScalarProps(
  instance: Component,
  compiled: CompiledComponent,
  props: Map<string, PropertyMeta>,
): void {
  const target = instance as unknown as Record<string, unknown>;
  for (const [attr, value] of Object.entries(compiled.props)) {
    const meta = props.get(attr);
    if (!meta) continue;
    const elem = elementType(meta.type);
    if (isReferenceType(elem)) continue; // wired in the reference pass
    target[attr] = isArrayType(meta.type)
      ? (value as CompiledScalar[]).map((v) => toRuntimeValue(elem, v))
      : toRuntimeValue(elem, value as CompiledScalar);
  }
  // Coerce *unset* math props to the same Three type a set one becomes, so the
  // runtime field type is consistent however the author wrote the initializer
  // (e.g. `offset = [0,0,0]` or `{x,y,z}` → a Vector3, like a set value).
  for (const [name, meta] of props) {
    if (name in compiled.props || isArrayType(meta.type)) continue;
    const elem = elementType(meta.type);
    if (elem !== 'vec2' && elem !== 'vec3' && elem !== 'euler' && elem !== 'color') continue;
    const current = target[name] !== undefined ? target[name] : meta.default;
    if (current !== undefined) target[name] = coerceMathValue(elem, current);
  }
}

/** Coerce an already-runtime value (Vector/Euler/Color, array, {x,y,z}, number) to the math type for `elem`. */
function coerceMathValue(elem: PropType | { new (): unknown } | EnumDef, current: unknown): unknown {
  switch (elem) {
    case 'vec2':
      return current instanceof Vector2 ? current : new Vector2().fromArray(toNumberArray(current, 2));
    case 'vec3':
      return current instanceof Vector3 ? current : new Vector3().fromArray(toNumberArray(current, 3));
    case 'euler': {
      if (current instanceof Euler) return current;
      const a = toNumberArray(current, 3);
      return new Euler(a[0]!, a[1]!, a[2]!);
    }
    case 'color':
      return current instanceof Color ? current : new Color(current as number | string);
    default:
      return current;
  }
}

function toNumberArray(v: unknown, n: number): number[] {
  if (Array.isArray(v)) return v as number[];
  if (v !== null && typeof v === 'object') {
    const o = v as { x?: number; y?: number; z?: number };
    return n === 2 ? [o.x ?? 0, o.y ?? 0] : [o.x ?? 0, o.y ?? 0, o.z ?? 0];
  }
  return n === 2 ? [0, 0] : [0, 0, 0];
}

/**
 * Convert a compiled scalar into the Three.js-typed value a component field
 * expects. Enums (and float/int/bool/string) pass through — their compiled form
 * is already the native runtime value.
 */
function toRuntimeValue(type: PropType | { new (): unknown } | EnumDef, value: CompiledScalar): unknown {
  switch (type) {
    case 'vec2':
      return new Vector2().fromArray(value as number[]);
    case 'vec3':
      return new Vector3().fromArray(value as number[]);
    case 'euler': {
      const e = value as number[];
      return new Euler(e[0]!, e[1]!, e[2]!);
    }
    case 'color':
      return new Color(value as number);
    default:
      return value; // float/int/bool/string
  }
}

/** A reference element type — resolved against the scene, not parsed as a scalar/enum. */
function isReferenceType(elem: PropType | { new (): unknown } | EnumDef): boolean {
  // Component-class refs are constructors (functions); 'node'/'prefab' are strings.
  // Scalars are strings and enums are plain objects — neither is a reference.
  return typeof elem === 'function' || elem === 'node' || elem === 'prefab';
}

/** Fallback for a prefab prop instantiated without an engine (pure/standalone use). */
const unboundSpawn: SpawnFn = () => {
  throw new Error('PrefabRef.spawn() needs an engine — instantiate the scene via Engine.loadScene/instantiate.');
};
