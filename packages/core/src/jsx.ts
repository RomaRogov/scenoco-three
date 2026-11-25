/**
 * TSX on three.js: the kernel's runtime, with three.js bound first (`port.ts`) — what `jsx-runtime`
 * and `jsx-dev-runtime` export.
 */
import { assetOf } from '@scenoco/kernel/internal';
import { Model } from './assets/Model.js';
import './port.js';

export { jsx, jsxs, jsxDEV, Fragment, prefab, isPrefab, ref, type Ref, type SceneJSX as ThreeJSX } from '@scenoco/kernel';
export { applyProp, isClass, isBehaviourClass, addMarker, instanceKeys } from '@scenoco/kernel/internal';

/** @internal The model a prefab is made from, if it is a model's. */
export function modelOf(value: unknown): Model | undefined {
  const asset = assetOf(value);
  return asset instanceof Model ? asset : undefined;
}
