import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Mesh, Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  Component,
  SceneManager,
  System,
  Time,
  type ComponentType,
  type SceneType,
  type SystemType,
} from '@scenoco-three/core';
import { build } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * The claim the whole design rests on: the generated TypeScript is ordinary, correct code.
 *
 * So this case does not inspect strings. It runs `tsc` over the project *including* the
 * generated files, then imports the generated scene and loads it in the real runtime. If
 * codegen were producing something that only looked right, both halves would catch it.
 */
let fixture: Fixture;

beforeAll(async () => {
  fixture = makeFixture('generated', { particles: true });

  fixture.write(
    'components/Spinner.ts',
    `import { Component } from '@scenoco-three/core';

/** Turns its node about Y. */
export class Spinner extends Component {
  speed = 1;
  turns = 0;
  override update(dt: number): void {
    this.turns += this.speed * dt;
    this.object3D.rotation.y = this.turns;
  }
}
`,
  );
  fixture.write(
    'systems/Gravity.ts',
    `import { System } from '@scenoco-three/core';
import { Vector3 } from 'three';

/** A stand-in physics world: the shape a real one will take. */
export class Gravity extends System {
  acceleration = new Vector3(0, -10, 0);
  steps = 0;
  readonly bodies: { velocity: Vector3; object3D: { position: Vector3 } }[] = [];

  override fixedUpdate(dt: number): void {
    this.steps++;
    for (const body of this.bodies) {
      body.velocity.addScaledVector(this.acceleration, dt);
      body.object3D.position.addScaledVector(body.velocity, dt);
    }
  }
}
`,
  );
  fixture.write(
    'components/Falling.ts',
    `import { Component } from '@scenoco-three/core';
import { Vector3 } from 'three';
import { Gravity } from '../systems/Gravity.js';

export class Falling extends Component {
  velocity = new Vector3();
  override awake(): void { this.requireSystem(Gravity).bodies.push(this); }
}
`,
  );
  // A tag package contributes its vocabulary to a project that depends on it, and a dependency
  // is what an import is. `ParticleSystem` is also the handle game code plays an effect with.
  fixture.write(
    'components/Sparkle.ts',
    `import { Component } from '@scenoco-three/core';
import { ParticleSystem } from '@scenoco-three/particles';

/** Restarts the emitter on its own node. */
export class Sparkle extends Component {
  override start(): void { this.getComponent(ParticleSystem)?.restart(); }
}
`,
  );
  fixture.write(
    'components/Counter.ts',
    `import { Component } from '@scenoco-three/core';
import { Mesh } from 'three';

export class Counter extends Component {
  /** Everything it watches. */
  watched: Mesh[] = [];
  target!: Mesh;
}
`,
  );

  fixture.writeXml('assets/geometry/cube.asset.xml', '<BoxGeometry width="1" height="1" depth="1" />');
  // A particle effect is an asset like any other: its own document, referenced by path. The
  // vocabulary in it is read from `ParticleEffect`'s declaration in the real package.
  fixture.writeXml(
    'assets/vfx/spark.particle.xml',
    `<ParticleEffect duration="1" looping="false" startLifetime="0.8" startColor="#ffdd66">
  <Emission rateOverTime="60">
    <Burst time="0" count="8" />
  </Emission>
  <Shape type="Sphere" radius="0.2" />
  <ColorOverLifetime colors="[#ffee88, #661100]" />
  <SizeOverLifetime curve="[1, 0]" />
</ParticleEffect>`,
  );
  fixture.writeXml('assets/materials/plain.asset.xml', '<MeshStandardMaterial color="#38bdf8" roughness="0.4" />');
  fixture.writeXml(
    'assets/scenes/cube.prefab.xml',
    `<Mesh geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml">
  <Components>
    <Spinner speed="2" />
  </Components>
</Mesh>`,
  );
  fixture.writeXml(
    'assets/scenes/demo.scene.xml',
    `<Scene>
  <Systems>
    <Gravity acceleration="y: -20" />
  </Systems>
  <PerspectiveCamera id="cam" fov="45" position="y: 2; z: 8" />
  <Mesh id="hero" geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml"
        position="y: 1" eulerAngles="y: 90" scale="2">
    <Components>
      <Counter target="#hero" watched="[#a, #b]" />
    </Components>
  </Mesh>
  <Prefab src="cube.prefab.xml" id="a" position="x: -2" />
  <Prefab src="cube.prefab.xml" id="b" position="x: 2" />
  <Prefab src="cube.prefab.xml" id="c" active="false" />
  <Mesh id="faller" geometry="../geometry/cube.asset.xml" material="../materials/plain.asset.xml"
        position="y: 10">
    <Components>
      <Falling />
    </Components>
  </Mesh>
  <Group id="sparks" position="y: 3">
    <Components>
      <ParticleSystem effect="../vfx/spark.particle.xml" />
    </Components>
  </Group>
</Scene>`,
  );

  const { diagnostics } = build({
    root: fixture.dir,
    tsconfig: fixture.tsconfig,
    modules: ['three', '@scenoco-three/particles'],
  });
  expect(diagnostics).toEqual([]);
}, 60_000);

afterAll(() => fixture.dispose());

/**
 * The generated modules are written at run time, so their types are not known statically.
 * These two helpers put the assertion back on solid ground without an `any` at every call.
 */
async function loadScene(): Promise<SceneType> {
  const module = (await import(join(fixture.dir, 'assets/scenes/demo.scene.gen.ts'))) as {
    DemoScene: SceneType;
  };
  return module.DemoScene;
}

async function loadComponent<T extends Component>(file: string, name: string): Promise<ComponentType<T>> {
  const module = (await import(join(fixture.dir, 'src/components', file))) as Record<
    string,
    ComponentType<T>
  >;
  return module[name]!;
}

/** The `id`-named fields a generated scene class carries. */
type Built = Record<string, Object3D | undefined>;

describe('generated code', () => {
  it('typechecks as part of the project', () => {
    const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
    expect(existsSync(tsc)).toBe(true);
    // `tsc` over the project, generated files included. A wrong reference type, a missing
    // import, a component on the wrong kind of node — all land here.
    let output = '';
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '-p', fixture.tsconfig], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }
    expect(output).toBe('');
  }, 120_000);

  it('loads in the real runtime and builds the tree the XML described', async () => {
    const scene = await SceneManager.load(await loadScene());
    const built = scene as unknown as Built;

    expect(built.cam).toBeInstanceOf(PerspectiveCamera);
    expect((built.cam as PerspectiveCamera).fov).toBe(45);
    expect(built.cam!.position.z).toBe(8);

    // A prefab spawns as its own node type, with no wrapper in between.
    expect(built.a).toBeInstanceOf(Mesh);
    expect(built.a!.parent).toBe(scene);
    expect(built.a!.position.x).toBe(-2);

    // Degrees in the document, radians on the Euler underneath.
    expect(built.hero!.eulerAngles.y).toBeCloseTo(90);
    expect(built.hero!.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(built.hero!.scale.x).toBe(2);

    await SceneManager.unloadAll();
  }, 60_000);

  it('spawns a prefab written active="false" inactive, and its generated call typechecks', async () => {
    // The spawn's `active` once reached `instantiate` as a key its placement did not have, and
    // tsc rejected the generated file.
    const scene = await SceneManager.load(await loadScene());
    const spawned = scene.byId('c')!;
    expect(spawned.activeSelf).toBe(false);
    expect(scene.byId('a')!.activeSelf).toBe(true);
  });

  it('wires component references to the real objects', async () => {
    const Counter = await loadComponent<Component & { target: Mesh; watched: Mesh[] }>(
      'Counter.ts',
      'Counter',
    );
    const scene = await SceneManager.load(await loadScene());

    const counter = scene.findObjectOfType(Counter)!;
    const built = scene as unknown as Built;
    // `#hero` and `[#a, #b]` are real objects, not string keys into an index that may miss.
    expect(counter.target).toBe(built.hero);
    expect(counter.watched).toEqual([built.a, built.b]);

    await SceneManager.unloadAll();
  }, 60_000);

  it('runs the components the prefab attached', async () => {
    const Spinner = await loadComponent<Component & { speed: number; turns: number }>(
      'Spinner.ts',
      'Spinner',
    );
    const scene = await SceneManager.load(await loadScene());

    const spinners = scene.findObjectsOfType(Spinner);
    expect(spinners).toHaveLength(2);
    expect(spinners[0]!.speed).toBe(2);

    let now = 0;
    for (let i = 0; i < 3; i++) SceneManager.tick((now += 100));
    expect(spinners[0]!.turns).toBeGreaterThan(0);

    await SceneManager.unloadAll();
  }, 60_000);
});

describe('systems, end to end', () => {
  it('declares the world in XML, configures it, and steps it once per fixed step', async () => {
    // The whole point of systems: a `<Systems>` block puts a configured physics world on the
    // scene, a component registers itself with `requireSystem` in `awake`, and the world steps
    // after every component's `fixedUpdate`.
    const Gravity = (await import(join(fixture.dir, 'src/systems/Gravity.ts'))) as {
      Gravity: SystemType<System & { acceleration: Vector3; steps: number; bodies: unknown[] }>;
    };
    Time.fixedDeltaTime = 0.02;
    const scene = await SceneManager.load(await loadScene());
    const gravity = scene.getSystem(Gravity.Gravity)!;

    // The scene's declaration won, not the component's default-created one.
    expect(gravity.acceleration.y).toBe(-20);
    expect(gravity.bodies).toHaveLength(1);

    const faller = (scene as unknown as Built).faller!;
    const startY = faller.position.y;
    let now = 0;
    for (let i = 0; i < 12; i++) SceneManager.tick((now += 20));

    expect(gravity.steps).toBeGreaterThan(5);
    expect(faller.position.y).toBeLessThan(startY);

    await SceneManager.unloadAll();
    Time.fixedDeltaTime = 1 / 50;
  }, 60_000);
});

describe('a particle effect, end to end', () => {
  it('compiles the document to a typed config and hands it to the emitter by reference', async () => {
    const { readFileSync } = await import('node:fs');
    const effect = readFileSync(join(fixture.dir, 'assets/vfx/spark.particle.gen.ts'), 'utf8');
    // Unity's module names in, one `ParticleConfig` out — with real `THREE.Color`s.
    expect(effect).toContain(`import type { ParticleEffect } from '@scenoco-three/particles';`);
    expect(effect).toContain('export const spark: ParticleEffect = {');
    expect(effect).toContain('startColor: new Color(0xffdd66),');
    expect(effect).toContain('bursts: [{ count: 8, time: 0 }],');

    // And the scene reaches it the same way a mesh reaches a geometry: by path, resolved to an
    // import of the one shared value.
    const scene = readFileSync(join(fixture.dir, 'assets/scenes/demo.scene.gen.ts'), 'utf8');
    expect(scene).toContain(`import { spark } from '../vfx/spark.particle.gen.js';`);
    expect(scene).toContain('effect: spark');
  }, 60_000);

  it('plays in the real runtime, batched by the system nothing declared', async () => {
    const { ParticleRenderer, ParticleSystem } = await import('@scenoco-three/particles');
    const scene = await SceneManager.load(await loadScene());

    // No `<ParticleRenderer />` in the document: the first emitter required one.
    expect(scene.getSystem(ParticleRenderer)).toBeInstanceOf(ParticleRenderer);

    const emitter = scene.findObjectOfType(ParticleSystem)!;
    expect(emitter.effect.startColor!.getHexString()).toBe('ffdd66');

    let now = 0;
    for (let i = 0; i < 3; i++) SceneManager.tick((now += 16));
    expect(emitter.particleCount).toBeGreaterThan(0);

    await SceneManager.unloadAll();
  }, 60_000);
});
