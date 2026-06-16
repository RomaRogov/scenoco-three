import { Color, Euler, type Object3D, Scene, Vector2, Vector3, type WebGLRenderer } from 'three';
import type { Component } from '../core/Component.js';
import { Registry, type PropertyMeta } from '../core/Registry.js';
import type { CompiledComponent, CompiledNode, CompiledRef, CompiledScene, CompiledValue } from './compiled.js';
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
  /** Index-aligned with CompiledScene.components. */
  components: { instance: Component; node: Object3D }[];
  /** One per pooled attachment (caching → shared geometry/material). */
  attachments: AttachmentInstance[];
}

/** Live scene/renderer context an attachment may configure (settings need it). */
export interface InstantiateContext {
  scene?: Scene;
  renderer?: WebGLRenderer;
  /**
   * How a `prefab` prop spawns its subtree (the Engine passes `engine.instantiate`).
   * Absent when instantiating standalone (pure tests) — a PrefabRef.spawn() then
   * throws a clear error rather than silently no-op.
   */
  spawn?: SpawnFn;
}

/**
 * Build live Three.js objects, attachments, and component instances from a
 * compiled scene. Attachments are pooled (one instance per entry → shared
 * resources); component references are wired by index in a second pass, so they
 * are valid before any component lifecycle runs.
 */
export function instantiateScene(compiled: CompiledScene, ctx: InstantiateContext = {}): InstantiatedScene {
  // A scene is needed by scene-targeted attachments (fog/background); default to
  // a throwaway when instantiating standalone (prefabs/tests use node attachments).
  const scene = ctx.scene ?? new Scene();
  const renderer = ctx.renderer;

  // One instance per pooled attachment entry, so caching shares the resource.
  const attachments = compiled.attachments.map((a) => getAttachmentDef(a.tag)!.make(a.attrs));
  const objects: Object3D[] = compiled.nodes.map((node) => buildObject(node));

  // Link the scene graph.
  compiled.nodes.forEach((node, i) => {
    for (const childIndex of node.children) objects[i]!.add(objects[childIndex]!);
  });

  // Apply attachments (geometry/material on the node, fog/background on the scene).
  compiled.nodes.forEach((node, i) => {
    for (const ai of node.attachments) attachments[ai]!.attach({ node: objects[i]!, scene, ...(renderer ? { renderer } : {}) });
  });

  // Create component instances and set their scalar props (refs come next).
  const instances: Component[] = compiled.components.map((c) => {
    const entry = Registry.getComponent(c.type)!;
    const instance = new entry.ctor();
    instance.node = objects[c.node]!;
    if (c.id !== undefined) instance.id = c.id;
    setScalarProps(instance, c, entry.meta.properties);
    return instance;
  });

  // Wire references now that every object and instance exists.
  const spawn: SpawnFn = ctx.spawn ?? unboundSpawn;
  compiled.components.forEach((c, i) => {
    const props = Registry.getComponent(c.type)!.meta.properties;
    for (const [attr, value] of Object.entries(c.props)) {
      if (!isRef(value)) continue;
      const meta = props.get(attr);
      if (!meta) continue;
      const target = instances[i] as unknown as Record<string, unknown>;
      if ('prefab' in value) {
        target[attr] = new PrefabRef(compiled.prefabs![value.prefab]!, spawn, instances[i]!.node);
      } else {
        target[attr] = 'node' in value ? objects[value.node] : instances[value.component];
      }
    }
  });

  return {
    root: objects[compiled.root]!,
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
    if (isRef(value)) continue;
    const meta = props.get(attr);
    if (!meta) continue;
    target[attr] = toRuntimeValue(meta.type, value);
  }
}

/** Convert a compiled scalar into the Three.js-typed value a component field expects. */
function toRuntimeValue(type: PropertyMeta['type'], value: CompiledValue): unknown {
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

function isRef(value: CompiledValue): value is CompiledRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fallback for a prefab prop instantiated without an engine (pure/standalone use). */
const unboundSpawn: SpawnFn = () => {
  throw new Error('PrefabRef.spawn() needs an engine — instantiate the scene via Engine.loadScene/instantiate.');
};
