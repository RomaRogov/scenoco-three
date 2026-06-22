import { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Engine, type Bundle } from '@scenoco-three/core';
import { Oscillator } from './fixtures/components/Oscillator.js';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
// A self-contained scene (no resource files) so these runtime-behaviour tests
// stay hermetic. Prefab expansion is covered separately in prefab.test.ts.
const SCENE = `<Scene>
  <Mesh id="Turbine_01" position="0 1 0">
    <CylinderGeometry radiusTop="0.4" radiusBottom="0.4" height="2" radialSegments="24" />
    <MeshStandardMaterial color="#8888aa" />
    <Components>
      <Rotator speed="2" />
      <Oscillator id="turbine_osc" axis="0 1 0" amplitude="0.5" frequency="0.5" />
    </Components>
  </Mesh>
  <Mesh id="Indicator" position="2.5 1 0">
    <SphereGeometry radius="0.3" />
    <Components>
      <Follow source="#turbine_osc" axis="0 1 0" scale="2" />
      <LookAt target="#Turbine_01" />
    </Components>
  </Mesh>
</Scene>`;

/** Build a runtime bundle the way the CLI would — the runtime never sees XML. */
function toBundle(xml: string): Bundle {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.diagnostics)}`);
  return bundleScene(result.scene);
}

const turbineBundle = toBundle(SCENE);

function findByName(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`node "${name}" not found`);
  return found;
}

describe('Engine.loadScene from a bundle (headless)', () => {
  it('loads the canonical turbine bundle', () => {
    const engine = new Engine();
    engine.loadScene(turbineBundle);

    const turbine = findByName(engine.scene, 'Turbine_01');
    expect(turbine).toBeInstanceOf(Mesh);
    expect((turbine as Mesh).geometry.type).toBe('CylinderGeometry');
  });

  it('runs Rotator from the bundle (one component animating a node)', () => {
    const engine = new Engine();
    engine.loadScene(turbineBundle);
    const turbine = findByName(engine.scene, 'Turbine_01');
    const before = turbine.rotation.y;
    engine.tick(1);
    expect(turbine.rotation.y).toBeGreaterThan(before);
  });

  it('drives one component from another through a bundled reference', () => {
    const engine = new Engine();
    engine.loadScene(turbineBundle);
    const indicator = findByName(engine.scene, 'Indicator');
    engine.tick(0.5);
    expect(indicator.position.y).toBeCloseTo(2, 1); // origin y(1) + amplitude(0.5)*scale(2)
  });

  it('wires a node reference (LookAt faces the turbine)', () => {
    const engine = new Engine();
    engine.loadScene(turbineBundle);
    const indicator = findByName(engine.scene, 'Indicator');
    const before = indicator.quaternion.clone();
    engine.tick(0.016);
    expect(indicator.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  });

  it('replaces the previous scene on reload and disposes its components', () => {
    const engine = new Engine();
    engine.loadScene(turbineBundle);
    engine.loadScene(toBundle(`<Scene><Mesh id="Solo"><BoxGeometry /></Mesh></Scene>`));
    expect(engine.scene.getObjectByName('Turbine_01')).toBeUndefined();
    expect(engine.scene.getObjectByName('Solo')).toBeDefined();
    void Oscillator;
  });

  it('exposes the authored id as the Object3D name', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(`<Scene><Mesh id="M"><BoxGeometry /></Mesh></Scene>`));
    expect(engine.scene.getObjectByName('M')).toBeDefined();
  });

  it('full swap: loadScene disposes the previous scene and its components', () => {
    const engine = new Engine();
    const inScene = new Object3D();
    engine.scene.add(inScene);
    const manual = engine.addComponent(inScene, Oscillator);

    engine.loadScene(turbineBundle); // swaps in a fresh Scene; the old one is gone

    // The previous scene's contents — including manually attached components — are torn down.
    expect(engine.getComponents(inScene)).toEqual([]);
    expect(engine.scene.getObjectByName('Turbine_01')).toBeDefined();
    // The detached component no longer ticks.
    engine.tick(0.25);
    expect(manual.offset).toBe(0);
  });

  it('also accepts a CompiledScene directly (advanced)', () => {
    const engine = new Engine();
    const result = compileSceneXml(`<Scene><Mesh id="C"><BoxGeometry /></Mesh></Scene>`);
    if (!result.ok) throw new Error('compile failed');
    engine.loadScene(result.scene);
    expect(engine.scene.getObjectByName('C')).toBeDefined();
  });
});

describe('Engine.loadScene — array property instantiation', () => {
  it('delivers float array to component as-is', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(`<Scene>
      <Mesh id="M"><BoxGeometry />
        <Components><ArrayProbe points="[1,2,3]" /></Components>
      </Mesh>
    </Scene>`));
    const node = engine.scene.getObjectByName('M')!;
    const comps = engine.getComponents(node);
    const probe = comps.find((c) => c.constructor.name === 'ArrayProbe') as unknown as { points: number[] };
    expect(probe.points).toEqual([1, 2, 3]);
  });

  it('delivers node-ref array as Object3D[]', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(`<Scene>
      <Mesh id="a"><BoxGeometry /></Mesh>
      <Mesh id="b"><BoxGeometry /></Mesh>
      <Mesh id="M"><BoxGeometry />
        <Components><ArrayProbe targets="[#a,#b]" /></Components>
      </Mesh>
    </Scene>`));
    const node = engine.scene.getObjectByName('M')!;
    const comps = engine.getComponents(node);
    const probe = comps.find((c) => c.constructor.name === 'ArrayProbe') as unknown as { targets: Object3D[] };
    expect(probe.targets).toHaveLength(2);
    expect(probe.targets[0]).toBe(engine.scene.getObjectByName('a'));
    expect(probe.targets[1]).toBe(engine.scene.getObjectByName('b'));
  });

  it('delivers typed component-ref array as component instances[]', () => {
    const engine = new Engine();
    engine.loadScene(toBundle(`<Scene>
      <Mesh id="a"><BoxGeometry /><Components><Oscillator id="o1" /></Components></Mesh>
      <Mesh id="b"><BoxGeometry /><Components><Oscillator id="o2" /></Components></Mesh>
      <Mesh id="M"><BoxGeometry />
        <Components><ArrayProbe oscillators="[#o1,#o2]" /></Components>
      </Mesh>
    </Scene>`));
    const node = engine.scene.getObjectByName('M')!;
    const comps = engine.getComponents(node);
    const probe = comps.find((c) => c.constructor.name === 'ArrayProbe') as unknown as {
      oscillators: InstanceType<typeof Oscillator>[];
    };
    expect(probe.oscillators).toHaveLength(2);
    expect(probe.oscillators[0]).toBeInstanceOf(Oscillator);
    expect(probe.oscillators[1]).toBeInstanceOf(Oscillator);
  });
});
