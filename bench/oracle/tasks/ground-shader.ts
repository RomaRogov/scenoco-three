import { expect } from 'vitest';
import type { Mesh } from 'three';
import { named } from '../arms.js';
import type { Game } from '../types.js';

/**
 * The ground is drawn by shader code the project wrote.
 *
 * Deliberately loose about *how*: a `ShaderMaterial`, a `RawShaderMaterial`, or a standard
 * material patched through `onBeforeCompile` are all real answers a three.js developer would
 * give, and a task that only accepted one of them would be grading style rather than outcome.
 */
export function check(game: Game): void {
  const ground = named(game, 'ground') as Mesh;
  const material = Array.isArray(ground.material) ? ground.material[0]! : ground.material;

  const source = [
    (material as { vertexShader?: string }).vertexShader ?? '',
    (material as { fragmentShader?: string }).fragmentShader ?? '',
    (material as { onBeforeCompile?: unknown }).onBeforeCompile?.toString() ?? '',
  ].join('\n');

  expect(source.length, 'the ground has no shader source of its own').toBeGreaterThan(0);
  // A grid every 2 units has to say so somewhere: a modulus, a fract, or the number itself.
  expect(/mod|fract|step|smoothstep/i.test(source), 'no grid maths in the shader').toBe(true);
}
