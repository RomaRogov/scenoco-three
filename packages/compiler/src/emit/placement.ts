import type { PropInfo } from '../model.js';

/**
 * The attributes every node accepts, whatever its tag.
 *
 * Placement is deliberately *not* read off the tag: `position` and `scale` are live `Vector3`s
 * three.js hands out once per node, so they are copied into rather than assigned, and
 * `eulerAngles` is a degrees view. Treating them as ordinary properties would emit
 * `node.position = new Vector3(…)`, which detaches a node from its own transform.
 */
export const PLACEMENT: Readonly<Record<string, PropInfo>> = {
  position: { name: 'position', type: 'Vector3', shape: 'vector3', required: false },
  eulerAngles: { name: 'eulerAngles', type: 'Vector3', shape: 'euler', required: false },
  scale: { name: 'scale', type: 'Vector3', shape: 'vector3', required: false, default: 'x: 1; y: 1; z: 1' },
  name: { name: 'name', type: 'string', shape: 'string', required: false },
  /**
   * Whether the node is on — Unity's `GameObject.SetActive`. Turns the whole subtree off: no
   * component hooks, nothing drawn, and on a UI element no space taken either.
   */
  active: { name: 'active', type: 'boolean', shape: 'boolean', required: false },
  /**
   * Whether the node is drawn — three.js's `visible`, and Unity's renderer switch.
   *
   * The narrower of the two: the node is still there and still updating, it just is not drawn.
   * A hidden UI element keeps its place in the layout, so hiding one does not shuffle the
   * elements beside it — which is the difference between this and `active`.
   */
  visible: { name: 'visible', type: 'boolean', shape: 'boolean', required: false },
};

/**
 * The order placement is applied in, whatever order the document wrote it, so one document has
 * one meaning. `active` goes last: it turns the whole subtree off, rendering included.
 */
export const PLACEMENT_ORDER = ['name', 'position', 'eulerAngles', 'scale', 'visible', 'active'] as const;

/**
 * "This node outlives the scene it was declared in" — Unity's `DontDestroyOnLoad`, spelled the
 * way Unity spells it.
 *
 * Not in `PLACEMENT`, because it is not a property of anything: it compiles to a call on
 * `SceneManager`, and on a `<Scene>` root it is a real property of the scene instead. One word,
 * one meaning, two emissions — which is why each site handles it rather than the shared table.
 */
export const PERSIST = 'dontDestroyOnLoad';

/**
 * The **engine's** attributes on `<Scene>` — the closed list, and the only ones there that
 * `THREE.Scene` does not declare itself.
 *
 * A closed list stated in one place is what makes the rest of `<Scene>` predictable: every
 * other attribute a document may write there is a property of three.js's `Scene`, so anyone who
 * knows three.js already knows the surface, and anyone who does not can look it up. That is not
 * true of a surface where `bloom` and `background` sit side by side looking identical while one
 * of them is invented — which is exactly what this replaced.
 */
export const SCENE_ATTRIBUTES: Readonly<Record<string, PropInfo>> = {
  /** Which camera the scene renders through — `mainCamera`, under the name a document writes. */
  camera: { name: 'camera', type: 'Camera', shape: 'nodeRef', required: false },
  /** How it is drawn: a path to a render document. */
  render: { name: 'render', type: 'RenderSettings', shape: 'assetRef', required: false },
  /** This scene survives `SceneManager.load` of another. */
  dontDestroyOnLoad: { name: PERSIST, type: 'boolean', shape: 'boolean', required: false },
  /** Whether unloading disposes the GPU resources it finds. */
  disposeOnUnload: { name: 'disposeOnUnload', type: 'boolean', shape: 'boolean', required: false },
};

/**
 * Attributes the graph emitter handles itself, so the tag pass must not see them.
 *
 * `src` is deliberately **not** here. It is structural on `<Prefab>` alone, which handles its own
 * attributes anyway — reserving the name everywhere silently dropped it from any tag that
 * declares a `src` of its own, which `<Image src="logo.png">` does.
 */
export const STRUCTURAL = new Set(['id', PERSIST, ...Object.keys(PLACEMENT)]);

/**
 * How each placement attribute is written onto a node.
 *
 * `scale` also takes a single number for uniform scale, which is what most authored scale
 * values are — `scale="2"` rather than `scale="x: 2; y: 2; z: 2"`.
 */
export function placementStatement(attribute: string, code: string, target: string): string {
  switch (attribute) {
    case 'position':
    case 'scale':
      return `${target}.${attribute}.copy(${code});`;
    case 'eulerAngles':
      // Degrees in, radians on the Euler underneath — the setter does the conversion, and it
      // is the only spelling that keeps `quaternion` in step.
      return `${target}.eulerAngles = ${code};`;
    case 'active':
      return `${target}.setActive(${code});`;
    default:
      return `${target}.${attribute} = ${code};`;
  }
}

/** `scale="2"` — a bare number means uniform scale. */
export function uniformScale(text: string): string | undefined {
  const value = Number(text.trim());
  return Number.isFinite(value) ? `${value}` : undefined;
}
