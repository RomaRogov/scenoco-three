import { Object3D, type Scene } from 'three';
import {
  addComponent,
  getComponent,
  getComponentInChildren,
  getComponentInParent,
  getComponents,
  getComponentsInChildren,
  type Behaviour,
  type BehaviourInit,
  type BehaviourType,
  type ConstructableBehaviour,
  type DrivesNode,
  type FitsNode,
} from './kernel/index.js';
import { isNodeDestroyed } from './kernel/lifecycle.js';

// Additions only: nothing three.js defines is replaced, so no three.js behaviour changes.
declare module 'three' {
  interface Object3D {
    /** Unity's `AddComponent`. */
    addComponent<T extends Behaviour, N extends Object3D>(this: N, type: ConstructableBehaviour<T> & DrivesNode<N>, init?: BehaviourInit<T>): T;
    addComponent<T extends Behaviour, N extends Object3D>(this: N, type: ConstructableBehaviour<T> & FitsNode<N, T>, init?: BehaviourInit<T>): T;
    /** Unity's `GetComponent`. */
    getComponent<T extends Behaviour>(type: BehaviourType<T>): T | null;
    getComponents<T extends Behaviour>(type: BehaviourType<T>): T[];
    getComponentInChildren<T extends Behaviour>(type: BehaviourType<T>): T | null;
    getComponentsInChildren<T extends Behaviour>(type: BehaviourType<T>): T[];
    getComponentInParent<T extends Behaviour>(type: BehaviourType<T>): T | null;
    /**
     * Unity's destroyed object: true once `destroy(node)` has taken effect — at the end of the frame it was
     * called in — on this node or one above it, as a behaviour's `isDestroyed` is once its `onDestroy` ran.
     */
    readonly isDestroyed: boolean;
    /**
     * Unity's `gameObject.scene`: the `<Scene>` this node is in — the nearest one above it, so a level's own
     * (its `background`, `fog` and `environment` are what draws) or, for a node `dontDestroyOnLoad` kept,
     * `game.scene`. Null for a node in no scene: `this.node.scene?.background`.
     */
    readonly scene: Scene | null;
  }
}

const methods: Partial<Object3D> = {
  addComponent(this: Object3D, type: ConstructableBehaviour, init?: object) {
    return addComponent(this, type as never, init as never);
  },
  getComponent(this: Object3D, type: BehaviourType) {
    return getComponent(this, type);
  },
  getComponents(this: Object3D, type: BehaviourType) {
    return getComponents(this, type);
  },
  getComponentInChildren(this: Object3D, type: BehaviourType) {
    return getComponentInChildren(this, type);
  },
  getComponentsInChildren(this: Object3D, type: BehaviourType) {
    return getComponentsInChildren(this, type);
  },
  getComponentInParent(this: Object3D, type: BehaviourType) {
    return getComponentInParent(this, type);
  },
} as Partial<Object3D>;

for (const [name, value] of Object.entries(methods)) {
  // `configurable` so a dev server evaluating this module twice replaces rather than throws.
  Object.defineProperty(Object3D.prototype, name, { value, configurable: true, writable: true });
}
Object.defineProperty(Object3D.prototype, 'isDestroyed', {
  get(this: Object3D) {
    return isNodeDestroyed(this);
  },
  configurable: true,
});
Object.defineProperty(Object3D.prototype, 'scene', {
  get(this: Object3D) {
    let node: Object3D | null = this;
    while (node && !(node as Scene).isScene) node = node.parent;
    return node as Scene | null;
  },
  // Code that keeps a `scene` of its own on an object still can: the value is that object's alone.
  set(this: Object3D, value: unknown) {
    Object.defineProperty(this, 'scene', { value, configurable: true, writable: true, enumerable: true });
  },
  configurable: true,
});
