/**
 * three.js, as the kernel asks for it: what a node is and how it moves, what a scene is and how it
 * draws. Everything else SceNoCo does is the kernel's. Bound when this module loads — the entry and
 * the JSX runtime both import it first, so it is bound before any scene is built.
 */
import * as THREE from 'three';
import {
  BasicShadowMap,
  Color,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Euler,
  type Material,
  type Mesh,
  type OrthographicCamera,
  type ShadowMapType,
} from 'three';
import { bindRenderer, type RendererPort, type View } from '@scenoco/kernel';
import { disposeBuilt, ownedBy } from './dispose.js';
import { threeEditor } from './editor/index.js';
import './renderer.js';

/** What a top-level scene alone draws with in three.js: Unity's RenderSettings. */
const SETTINGS = [
  'background', 'backgroundBlurriness', 'backgroundIntensity', 'backgroundRotation',
  'environment', 'environmentIntensity', 'environmentRotation', 'fog',
] as const;

/** What each renderer was set up with: a quality level scales and turns off from this, and gives it back. */
const own = new WeakMap<WebGLRenderer, { pixelRatio: number; shadows: boolean; shadowType: ShadowMapType }>();

const v = new Vector3();
const q = new Quaternion();

/** three.js's values, by their flags: what a tween and an attribute do with each. */
type Value = {
  isQuaternion?: boolean;
  isColor?: boolean;
  isVector2?: boolean;
  isVector3?: boolean;
  isVector4?: boolean;
  isEuler?: boolean;
  clone(): Value;
  copy(v: Value): Value;
  add(v: Value): Value;
  multiply(q: Value): Value;
  lerpVectors(a: Value, b: Value, t: number): Value;
  slerpQuaternions(a: Value, b: Value, t: number): Value;
  lerpColors(a: Value, b: Value, t: number): Value;
};

export const threePort: RendererPort = {
  nodeKind: 'an Object3D',
  nameKey: 'name',

  isNode(value): value is Object3D {
    if (value instanceof Object3D) return true;
    // A three.js object that is not this three's: the project has two copies, and `instanceof` across them is false.
    if ((value as { isObject3D?: boolean }).isObject3D) {
      throw new Error(
        "An element is a three.js object from another copy of three.js than SceNoCo's: the project has two (`npm ls three` lists them). " +
          "Install one — `npm dedupe` — or, under Vite or Vitest, add `resolve: { dedupe: ['three'] }` to the config.",
      );
    }
    return false;
  },
  add: (parent, child) => void parent.add(child),
  reparent: (parent, child) => void parent.attach(child),
  isVisible: (node) => node.visible,

  // R3F's defaults: a geometry and a material fill their slots, and are the node's, freed with it.
  attachChild(parent, child) {
    const kind = child as { isBufferGeometry?: boolean; isMaterial?: boolean };
    const slot = kind.isBufferGeometry ? 'geometry' : kind.isMaterial ? 'material' : null;
    if (!slot) return false;
    (parent as Record<string, unknown>)[slot] = child;
    ownedBy(child, parent);
    return true;
  },
  adopt: ownedBy,
  freeBuilt: disposeBuilt,

  createScene: () => new Scene(),
  isScene: (node) => (node as Scene).isScene === true,
  /**
   * The loaded scene's settings are its to say, so they move to the scene that draws — what it does not
   * set is unset — and from then on the loaded scene's own properties are the drawing scene's: a
   * behaviour writing `scene.environment` on the `<Scene>` it lives in changes what is drawn.
   */
  adoptSettings(scene, root) {
    const from = scene as unknown as Record<string, unknown>;
    const to = root as unknown as Record<string, unknown>;
    for (const key of SETTINGS) {
      to[key] = from[key];
      Object.defineProperty(scene, key, { get: () => to[key], set: (value) => (to[key] = value), configurable: true, enumerable: true });
    }
  },

  isCamera: (node) => (node as Camera).isCamera === true,
  /** Unity's orthographic size: the height it shows is the scene's, the width follows the screen. */
  fitCamera(camera, width, height) {
    const aspect = width / height;
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as OrthographicCamera;
      const half = ((ortho.top - ortho.bottom) / 2) * aspect;
      const middle = (ortho.left + ortho.right) / 2;
      ortho.left = middle - half;
      ortho.right = middle + half;
    } else {
      (camera as PerspectiveCamera).aspect = aspect;
    }
    camera.updateProjectionMatrix();
  },
  project(camera, [x, y, z]) {
    camera.updateMatrixWorld();
    const p = v.set(x, y, z).project(camera);
    return [p.x, p.y];
  },
  createView(options, _scene): View {
    const given = (options as { renderer?: WebGLRenderer }).renderer;
    const renderer = given ?? new WebGLRenderer();
    // One without antialiasing when not given: crisp pixels, and none of the multisampling's cost on a phone.
    if (!given) renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const size = new Vector2();
    return {
      renderer,
      element: renderer.domElement,
      size: () => (renderer.getSize(size), [size.x, size.y]),
      setSize: (width, height) => renderer.setSize(width, height),
      render: (scene, camera) => camera && renderer.render(scene, camera),
      setLoop: (frame) => renderer.setAnimationLoop(frame),
      // A renderer the game was given is the caller's to dispose of.
      dispose: () => void (given ? undefined : renderer.dispose()),
    };
  },
  applyQuality(renderer, scene, level) {
    let base = own.get(renderer);
    if (!base) own.set(renderer, (base = { pixelRatio: renderer.getPixelRatio(), shadows: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type }));
    renderer.setPixelRatio(base.pixelRatio * level.renderScale);
    const enabled = base.shadows && level.shadows !== 0;
    const type = level.shadows === 1 ? BasicShadowMap : base.shadowType;
    if (renderer.shadowMap.enabled === enabled && renderer.shadowMap.type === type) return;
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.type = type;
    // Shadows on or off is another shader: every material compiles again.
    scene.traverse((node) => {
      const material = (node as Mesh).material as Material | Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
    });
  },

  getPosition: (node, world, out) => (world ? node.getWorldPosition(v) : node.position).toArray(out),
  setPosition(node, [x, y, z], world) {
    node.position.set(x, y, z);
    if (world && node.parent) node.parent.worldToLocal(node.position);
  },
  getRotation: (node, world, out) => (world ? node.getWorldQuaternion(q) : node.quaternion).toArray(out),
  setRotation(node, [x, y, z, w], world) {
    node.quaternion.set(x, y, z, w);
    if (world && node.parent) node.quaternion.premultiply(node.parent.getWorldQuaternion(q).invert());
  },
  getScale: (node, out) => node.scale.toArray(out),
  setScale: (node, [x, y, z]) => void node.scale.set(x, y, z),
  lookRotation(node, [x, y, z]) {
    const start = node.quaternion.clone();
    node.lookAt(x, y, z);
    const end = node.quaternion.toArray() as [number, number, number, number];
    node.quaternion.copy(start);
    return end;
  },

  vector2: (x, y) => new Vector2(x, y),
  vector3: (x, y, z) => new Vector3(x, y, z),
  quaternion: (x, y, z, w) => new Quaternion(x, y, z, w),
  color: (r, g, b) => new Color().setRGB(r, g, b, SRGBColorSpace),
  values: {
    clone: (v) => (v as unknown as Value).clone() as never,
    mix(from, to, t, out) {
      const [o, a, b] = [out, from, to] as unknown as Value[];
      if (o!.isQuaternion) o!.slerpQuaternions(a!, b!, t);
      else if (o!.isColor) o!.lerpColors(a!, b!, t);
      else o!.lerpVectors(a!, b!, t);
      return out;
    },
    sum(a, b) {
      const [x, y] = [a, b] as unknown as Value[];
      return (x!.isQuaternion ? x!.clone().multiply(y!) : x!.clone().add(y!)) as never;
    },
    /**
     * A value is copied into the one the property holds — a node's `position` stays its own; a thing with a
     * `uuid` (a geometry, a material, a texture, a node) is shared, assigned by reference.
     */
    assign(owner, key, value) {
      const current = owner[key] as (Value & { uuid?: string }) | null | undefined;
      const same = current && typeof current === 'object' && value && typeof value === 'object' && !('uuid' in current) &&
        value instanceof (current.constructor as new () => unknown) && typeof current.copy === 'function';
      if (same) current!.copy(value as Value);
      else owner[key] = value;
    },
  },
  // three.js's `Euler` is radians in its own order; any other vector is a tween's degrees.
  eulerOf: (value) => {
    const euler = value as Euler;
    return euler.isEuler ? { x: euler.x, y: euler.y, z: euler.z, order: euler.order } : undefined;
  },
  ...(import.meta.env?.DEV ? development() : {}),
};

/**
 * What only the bridge and the editor ask, and only in development: behind the gate above, a
 * production build keeps none of it — `{ THREE }` alone would keep every class three.js has.
 */
function development(): Partial<RendererPort> {
  return {
    plain(value) {
      const own = value as { isVector2?: boolean; isVector3?: boolean; isVector4?: boolean; isQuaternion?: boolean; isEuler?: boolean; isColor?: boolean };
      if (own.isVector2 || own.isVector3 || own.isVector4 || own.isQuaternion || own.isEuler) {
        return (value as { toArray(): unknown[] }).toArray().filter((x) => typeof x === 'number');
      }
      if (own.isColor) return `#${(value as Color).getHexString()}`;
      return undefined;
    },
    viewCamera(fov, aspect, [x, y, z], at) {
      const eye = new PerspectiveCamera(fov, aspect, 0.05, 2000);
      eye.position.set(x, y, z);
      eye.lookAt(...at);
      return eye;
    },
    isDerived: (value) => !!((value as { isMatrix3?: boolean; isMatrix4?: boolean }).isMatrix3 || (value as { isMatrix4?: boolean }).isMatrix4),
    // A geometry made again with other arguments is copied into the one in use, so every mesh sharing it sees it.
    canRemake: (target) => !(target instanceof Object3D) && typeof (target as { copy?: unknown }).copy === 'function',
    remake(target, fresh) {
      const [old, made] = [target, fresh] as { copy(v: object): void; dispose?(): void }[];
      old!.dispose?.();
      old!.copy(fresh);
      made!.dispose?.();
    },
    free: (value) => (value as { dispose?(): void }).dispose?.(),
    // What the editor changed in place: a material compiles again, a camera projects anew.
    refresh(target) {
      const own = target as { isMaterial?: boolean; isTexture?: boolean; needsUpdate?: boolean; updateProjectionMatrix?: () => void };
      if (own.isMaterial || own.isTexture) own.needsUpdate = true;
      own.updateProjectionMatrix?.();
    },
    bridgeScope: { THREE },
    editor: threeEditor,
  };
}

bindRenderer(threePort);
