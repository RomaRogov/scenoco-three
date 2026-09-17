import { Group, type Object3D } from 'three';
import { ParticleBatch } from './batch.js';
import type { ParticleEffect } from './config.js';

/**
 * What a `<ParticleSystem>` looks like in an editor.
 *
 * A still frame of an effect says nothing, so this hands back an `update` and the editor drives it
 * from the transport beside the component — play, pause, and a stop that starts it over.
 *
 * It builds the effect with {@link ParticleBatch}, which is the same class the scene's
 * `ParticleRenderer` builds it with: same parameters, same batching, same step. Nothing about an
 * effect is implemented twice, so nothing about it can look one way in the editor and another in
 * the game.
 *
 * This file is bundled to one module with `three` left external — three.quarks travels with it,
 * because an editor has no way to resolve a package.
 */
export default function preview(props: { effect?: ParticleEffect }): {
  object: Object3D;
  update: (deltaTime: number) => void;
} | null {
  // Nothing to draw until the document names an effect; the compiler already requires it of a
  // finished document, so this is the half-written one.
  if (!props.effect) return null;

  const object = new Group();
  const batch = new ParticleBatch();
  // The renderer is what draws, and the emitter is what is placed: both belong under the node.
  object.add(batch.object);
  batch.add(props.effect, object);

  return { object, update: (deltaTime) => batch.step(deltaTime) };
}
