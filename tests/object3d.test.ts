import { describe, expect, it } from 'vitest';
import {
  Line,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  SpotLight,
  Sprite,
  SpriteMaterial,
} from 'three';
import { Component, Engine, component, instantiateScene } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

describe('full Object3D coverage (goal 2)', () => {
  it('instantiates lights, cameras, lines, points, and sprites to the right classes', () => {
    const scene = compile(`<Scene>
      <SpotLight id="spot" angle="0.5" />
      <OrthographicCamera id="ortho" />
      <Line id="line"><BoxGeometry /><LineBasicMaterial color="#ff0000" /></Line>
      <Points id="pts"><SphereGeometry /><PointsMaterial size="3" /></Points>
      <Sprite id="spr"><SpriteMaterial color="#00ff00" /></Sprite>
    </Scene>`);
    const live = instantiateScene(scene);
    expect(live.root.getObjectByName('spot')).toBeInstanceOf(SpotLight);
    expect(live.root.getObjectByName('ortho')).toBeInstanceOf(OrthographicCamera);
    expect(live.root.getObjectByName('line')).toBeInstanceOf(Line);
    const pts = live.root.getObjectByName('pts') as Points;
    expect(pts).toBeInstanceOf(Points);
    expect(pts.material).toBeInstanceOf(PointsMaterial);
    const spr = live.root.getObjectByName('spr') as Sprite;
    expect(spr).toBeInstanceOf(Sprite);
    expect(spr.material).toBeInstanceOf(SpriteMaterial);
  });

  it('preserves SpotLight attribute values', () => {
    const scene = compile(`<Scene><SpotLight id="s" intensity="4" penumbra="0.5" /></Scene>`);
    const light = instantiateScene(scene).root.getObjectByName('s') as SpotLight;
    expect(light.intensity).toBe(4);
    expect(light.penumbra).toBe(0.5);
  });
});

describe('components on any node, incl. lights/cameras/scene (goal 2)', () => {
  it('allows <Components> on a camera and on the Scene root', () => {
    const result = compileSceneXml(`<Scene>
      <Components><Spin /></Components>
      <PerspectiveCamera id="cam">
        <Components><Spin /></Components>
      </PerspectiveCamera>
    </Scene>`.replace(/Spin/g, 'Rotator'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One component on the Scene node, one on the camera node.
    expect(result.scene.components.length).toBe(2);
  });
});

describe('typed node access (goal 2)', () => {
  @component({ name: 'FovSetter' })
  class FovSetter extends Component<PerspectiveCamera> {
    override start(): void {
      // Typed: no cast needed to reach PerspectiveCamera.fov.
      this.node.fov = 33;
      this.node.updateProjectionMatrix();
    }
  }

  it('a Component<PerspectiveCamera> manipulates camera-specific fields', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><PerspectiveCamera id="cam" /></Scene>`));
    const cam = engine.findObject('cam') as PerspectiveCamera;
    engine.addComponent(cam, FovSetter);
    engine.tick(0.016); // runs start()
    expect(cam.fov).toBe(33);
    engine.dispose();
  });
});

describe('active scene camera (goal 2)', () => {
  it('loadScene renders through a camera defined in the scene', () => {
    const engine = new Engine();
    expect(engine.mainCamera).toBeUndefined(); // the engine owns no camera
    const bundle = bundleScene(compile(`<Scene><PerspectiveCamera id="Main" fov="42" /></Scene>`));
    engine.loadScene(bundle);
    expect(engine.mainCamera).toBe(engine.findObject('Main'));
    expect((engine.mainCamera as PerspectiveCamera).fov).toBe(42);
    // No camera once the scene unloads — there is no built-in fallback.
    engine.disposeScene();
    expect(engine.mainCamera).toBeUndefined();
    engine.dispose();
  });
});
