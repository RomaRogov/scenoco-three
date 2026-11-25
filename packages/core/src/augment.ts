import { Object3D, type Scene } from 'three';
import {
  installNodeMethods,
  type Behaviour,
  type BehaviourInit,
  type BehaviourType,
  type ConstructableBehaviour,
  type DrivesNode,
  type FitsNode,
} from '@scenoco/kernel/internal';

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

installNodeMethods(Object3D.prototype);
