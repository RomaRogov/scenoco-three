import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, type Object3D } from 'three';

/**
 * The prototype suite's arms: a starter project per stack, at the same starting point.
 *
 * Every scaffold renders the same thing — a lit, turning cube on a ground — so a task measures
 * what the model can *add* to a running project rather than who was handed more to begin with.
 */
export interface Sketch {
  scene: { getObjectByName(name: string): Object3D | undefined } & Object3D;
  step(dt: number): void;
  dispose(): void;
}

export interface Arm {
  name: string;
  load: () => Promise<{ createSketch: () => Promise<Sketch> }>;
}

const ROOT = fileURLToPath(new URL('../arms', import.meta.url));

function harnessOf(name: string): string | null {
  for (const extension of ['ts', 'tsx']) {
    const path = `${ROOT}/${name}/src/harness.${extension}`;
    if (existsSync(path)) return path;
  }
  return null;
}

export function arms(): Arm[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => harnessOf(name) !== null)
    .filter((name) => existsSync(`${ROOT}/${name}/node_modules`))
    .sort()
    .map((name) => ({
      name,
      load: () => import(harnessOf(name)!) as Promise<{ createSketch: () => Promise<Sketch> }>,
    }));
}

export async function withSketch(arm: Arm, body: (s: Sketch) => Promise<void> | void): Promise<void> {
  const { createSketch } = await arm.load();
  const sketch = await createSketch();
  try {
    await body(sketch);
  } finally {
    sketch.dispose();
  }
}

/** Advance `seconds` of time in fixed 1/60 steps, the way a frame loop would. */
export function run(sketch: Sketch, seconds: number): void {
  const dt = 1 / 60;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) sketch.step(dt);
}

/** Every node carrying a name. Names are the only vocabulary the oracle and the task share. */
export function allNamed(sketch: Sketch, name: string): Object3D[] {
  const found: Object3D[] = [];
  sketch.scene.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
}

export function named(sketch: Sketch, name: string): Object3D {
  const [first] = allNamed(sketch, name);
  if (!first) throw new Error(`no object named "${name}"`);
  return first;
}

/**
 * How far the bottom of a node sits above y = 0, in world space.
 *
 * Measured from the bounding box rather than from `position`, because "standing on the ground" is
 * a fact about the shape and every stack sizes its shapes differently — a cylinder two units tall
 * rests at y = 1, a cube one unit tall at y = 0.5. Asking about the box asks the real question.
 */
export function groundGap(node: Object3D): number {
  node.updateMatrixWorld(true);
  return new Box3().setFromObject(node).min.y;
}
