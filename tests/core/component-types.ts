import type { Mesh, Object3D } from 'three';
import { Behaviour, addComponent, getComponent, type BehaviourType, type ConstructableBehaviour } from '@scenoco-three/core';

/** Typecheck-only: every line marked @ts-expect-error must stay an error, and every other line pass. */
abstract class Weapon extends Behaviour {
  level = 1;
}
class Bolt extends Weapon {
  private shots = 1;
}
class Ring extends Weapon {
  private radius = 2;
}
class Spin extends Behaviour<Mesh> {
  speed = 1;
}

// A helper generic over a family of behaviours: the node check resolves through `T extends Weapon`.
export function grant<T extends Weapon>(node: Object3D, kind: ConstructableBehaviour<T>): T {
  return getComponent(node, kind) ?? addComponent(node, kind);
}
export function grantMethod<T extends Weapon>(node: Object3D, kind: ConstructableBehaviour<T>): T {
  return node.getComponent(kind) ?? node.addComponent(kind);
}

// A list of kinds, typed by the family.
export function grantAll(node: Object3D): void {
  const kinds: ConstructableBehaviour<Weapon>[] = [Bolt, Ring];
  for (const kind of kinds) addComponent(node, kind);
  const lookups: BehaviourType<Weapon>[] = [Bolt, Ring];
  for (const kind of lookups) getComponent(node, kind);
}

// A behaviour that drives a Mesh goes on a Mesh, and not on a node known only as an Object3D.
export function onMesh(mesh: Mesh, node: Object3D): void {
  addComponent(mesh, Spin);
  mesh.addComponent(Spin);
  // @ts-expect-error drives a narrower node class than this node is typed as
  addComponent(node, Spin);
  // @ts-expect-error drives a narrower node class than this node is typed as
  node.addComponent(Spin);
}
