import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, Scene, WebGLRenderTarget } from 'three';
import { Behaviour, Runtime, SceneManager, dontDestroyOnLoad, instantiate, prefab, ref } from '@scenoco-three/core';
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
  it('puts what is instantiated with no parent into the active scene, so the next load destroys it', () => {
    const { world, frame } = game();
    SceneManager.load(One);
    const shard = instantiate(prefab(() => <Group name="shard" />));
    expect(shard.parent).toBe(SceneManager.activeScene);
    SceneManager.load(Two);
    frame();
    expect(world.getObjectByName('shard')).toBeUndefined();
  });

  it('swaps scenes: the last one is destroyed, what was kept stays', () => {
    const { world, frame } = game();
    SceneManager.load(Run);
    const keep = world.children[0]!.getComponent(Keep)!;
    SceneManager.load(One);
    frame();
    expect((world.background as Color).getHexString()).toBe('ff0000'); // the loaded scene's backdrop draws

    SceneManager.load(Two);
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

  it("draws what a behaviour sets on its own <Scene> after load, as Unity's RenderSettings", () => {
    class Sky extends Behaviour<Scene> {
      override start() {
        this.node.background = new Color('#00ff00');
        this.node.environmentIntensity = 0.5;
        this.node.backgroundRotation.y = 1;
      }
    }
    const Lit = () => (
      <Scene backgroundBlurriness={0.3}>
        <Sky />
      </Scene>
    );
    const { world, frame } = game();
    SceneManager.load(Lit);
    expect(world.backgroundBlurriness).toBe(0.3); // set at load, with the rest of RenderSettings
    frame();
    expect((world.background as Color).getHexString()).toBe('00ff00');
    expect(world.environmentIntensity).toBe(0.5);
    expect(world.backgroundRotation.y).toBe(1);
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

  it('loads as Unity does from a frame: the rest of it runs, the old scene goes, the new one wakes, sceneLoaded, then start', () => {
    const { frame } = game();
    const log: string[] = [];
    class Old extends Behaviour {
      go = false;
      override update() {
        if (this.go) {
          this.go = false;
          SceneManager.load(New);
          log.push('load returned');
        }
      }
      override lateUpdate() {
        if (log.length) log.push('old lateUpdate');
      }
      override onDestroy() {
        log.push('old onDestroy');
      }
    }
    class Fresh extends Behaviour {
      override awake() {
        log.push('new awake');
      }
      override start() {
        log.push('new start');
      }
    }
    const New = () => (
      <Scene>
        <Fresh />
      </Scene>
    );
    const old = ref<Old>();
    SceneManager.load(() => (
      <Scene>
        <Old ref={old} />
      </Scene>
    ));
    const loaded = () => log.push('sceneLoaded');
    SceneManager.sceneLoaded.on(loaded);
    frame();
    old.current!.go = true;
    frame();
    frame();
    SceneManager.sceneLoaded.off(loaded);
    expect(log).toEqual(['load returned', 'old lateUpdate', 'old onDestroy', 'new awake', 'sceneLoaded', 'new start']);
  });
});
