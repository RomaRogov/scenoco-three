import { Object3D } from 'three';
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
  type NodeOf,
} from './kernel/index.js';

// Additions only: nothing three.js defines is replaced, so no three.js behaviour changes.
declare module 'three' {
  interface Object3D {
    /** Unity's `AddComponent`. */
    addComponent<T extends Behaviour>(this: NodeOf<T>, type: ConstructableBehaviour<T>, init?: BehaviourInit<T>): T;
    /** Unity's `GetComponent`. */
    getComponent<T extends Behaviour>(type: BehaviourType<T>): T | null;
    getComponents<T extends Behaviour>(type: BehaviourType<T>): T[];
    getComponentInChildren<T extends Behaviour>(type: BehaviourType<T>): T | null;
    getComponentsInChildren<T extends Behaviour>(type: BehaviourType<T>): T[];
    getComponentInParent<T extends Behaviour>(type: BehaviourType<T>): T | null;
  }
}

const methods: Partial<Object3D> = {
  addComponent(this: Object3D, type: ConstructableBehaviour, init?: object) {
    return addComponent(this as never, type, init as never);
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
