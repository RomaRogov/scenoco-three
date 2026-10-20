import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, Scene, WebGLRenderTarget } from 'three';
import { Behaviour, Runtime, SceneManager, dontDestroyOnLoad, ref } from '@scenoco-three/core';
import { attachWorld } from '../../packages/core/src/scenes.js';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));

/** What `play` sets up, minus the renderer: one scene that draws, with a runtime. */
function game(): { world: Scene; frame: () => void } {
  const world = new Scene();
  const runtime = new Runtime(world);
  runtimes.push(runtime);
  attachWorld(world, () => {});
  return { world, frame: () => runtime.update(1 / 60) };
}

class Keep extends Behaviour {
  destroyed = false;
  override awake() {
    dontDestroyOnLoad(this);
  }
  override onDestroy() {
    this.destroyed = true;
  }
}

const Run = () => (
  <Scene>
    <Keep />
  </Scene>
);
const One = () => (
  <Scene>
    <Color attach="background" args={['#ff0000']} />
    <Group name="one" />
  </Scene>
);
const Two = () => (
  <Scene>
    <Group name="two" />
  </Scene>
);

describe('SceneManager', () => {
  it('swaps scenes as Unity does: the last load is destroyed at the end of the frame, what was kept stays', () => {
    const { world, frame } = game();
    SceneManager.load(Run);
    const keep = world.children[0]!.getComponent(Keep)!;
    SceneManager.load(One);
    frame();
    expect(world.getObjectByName('one')).toBeDefined();
    expect((world.background as Color).getHexString()).toBe('ff0000'); // the loaded scene's backdrop draws

    SceneManager.load(Two);
    expect(world.getObjectByName('one')).toBeDefined(); // still there until the frame ends
    frame();
    expect(world.getObjectByName('one')).toBeUndefined();
    expect(world.getObjectByName('two')).toBeDefined();
    expect(world.background).toBeNull();
    expect(keep.destroyed).toBe(false);
    expect(keep.isActiveAndEnabled).toBe(true);

    SceneManager.loadAdditive(One);
    frame();
    expect(world.getObjectByName('two')).toBeDefined(); // additive: nothing unloaded
    expect(SceneManager.activeScene?.getObjectByName('one')).toBeDefined();
  });

  it('frees what a scene built when it goes, and leaves what it only named', () => {
    const { frame } = game();
    const paint = new MeshStandardMaterial(); // an assets.ts constant: every scene may name it
    const freed: string[] = [];
    const box = ref<BoxGeometry>();
    const sun = ref<DirectionalLight>();
    const Level = () => (
      <Scene>
        <Mesh material={paint}>
          <BoxGeometry ref={box} />
        </Mesh>
        <DirectionalLight ref={sun} castShadow />
      </Scene>
    );
    SceneManager.load(Level);
    box.current!.addEventListener('dispose', () => freed.push('box'));
    paint.addEventListener('dispose', () => freed.push('paint'));
    // What the renderer gives a shadow-casting light on its first frame: a map on the GPU.
    sun.current!.shadow.map = new WebGLRenderTarget(16, 16);
    sun.current!.shadow.map.addEventListener('dispose', () => freed.push('shadow map'));
    SceneManager.load(Two);
    frame();
    expect(freed).toEqual(['box', 'shadow map']);
  });
});
