import {
  Color,
  Fog,
  Group,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CameraFit,
  Component,
  Effect,
  Engine,
  RenderSettings,
  RenderState,
  SceneManager,
  System,
} from '@scenoco-three/core';
import { Clock, resetEngine, sceneOf } from './helpers.js';

afterEach(resetEngine);

class Marker extends Component {
  label = 'marker';
}

describe('dontDestroyOnLoad', () => {
  it('keeps a node, its components and its ticking across a scene load', async () => {
    const ticks: string[] = [];
    class Counter extends Component {
      override update() {
        ticks.push('tick');
      }
    }

    let survivor!: Object3D;
    const first = sceneOf((scene) => {
      survivor = new Group();
      survivor.name = 'hud';
      scene.add(survivor);
      survivor.addComponent(Counter);
      SceneManager.dontDestroyOnLoad(survivor);
    });

    await SceneManager.load(first);
    expect(survivor.scene).toBe(SceneManager.persistentScene);

    await SceneManager.load(sceneOf(() => {}));
    // The scene it was declared in is gone; the node is not, and it is still being ticked.
    expect(survivor.isDestroyed).toBe(false);
    expect(survivor.getComponent(Counter)).not.toBeNull();
    const before = ticks.length;
    new Clock().frame();
    expect(ticks.length).toBeGreaterThan(before);
  });

  it('exempts a whole scene, which is the shape that cannot end up duplicated', async () => {
    const Hud = sceneOf((scene) => {
      scene.createObject('readout').addComponent(Marker);
    });
    const hud = await SceneManager.loadAdditive(Hud);
    SceneManager.dontDestroyOnLoad(hud);

    await SceneManager.load(sceneOf(() => {}));
    expect(SceneManager.isLoaded(Hud)).toBe(true);
    // Asking for it again is a no-op, so every level may ask and exactly one exists.
    await SceneManager.loadAdditive(Hud);
    expect(SceneManager.findObjectsOfType(Marker)).toHaveLength(1);
  });

  it('finds a component in any loaded scene, which is how a new level reaches a survivor', async () => {
    const first = sceneOf((scene) => {
      const node = scene.createObject('rules');
      node.addComponent(Marker, { label: 'kept' });
      SceneManager.dontDestroyOnLoad(node);
    });
    await SceneManager.load(first);

    const level = sceneOf(() => {});
    await SceneManager.load(level);
    // The new scene has no marker of its own; the global lookup still finds the survivor.
    expect(SceneManager.getScene(level)!.findObjectOfType(Marker)).toBeNull();
    expect(SceneManager.findObjectOfType(Marker)?.label).toBe('kept');
  });
});

describe('System.start', () => {
  it('runs once, after every component has woken and started', async () => {
    const order: string[] = [];
    class Registrar extends Component {
      override awake() {
        order.push('component:awake');
        this.requireSystem(Census).seen++;
      }
      override start() {
        order.push('component:start');
      }
    }
    class Census extends System {
      seen = 0;
      counted = -1;
      override awake() {
        order.push('system:awake');
      }
      override start() {
        order.push('system:start');
        this.counted = this.seen;
      }
    }

    await SceneManager.load(
      sceneOf((scene) => {
        scene.createObject('a').addComponent(Registrar);
        scene.createObject('b').addComponent(Registrar);
      }),
    );
    const clock = new Clock();
    clock.frames(2);

    const census = SceneManager.activeScene!.getSystem(Census)!;
    // By `start` the document is finished, so what the system counted is the whole scene.
    expect(census.counted).toBe(2);
    expect(order.filter((o) => o === 'system:start')).toHaveLength(1);
    expect(order.indexOf('system:start')).toBeGreaterThan(order.lastIndexOf('component:start'));
  });
});

describe('instantiate(configure)', () => {
  it('applies overrides after the prefab is built and before anything in it wakes', async () => {
    const seen: string[] = [];
    class Reader extends Component {
      label = 'default';
      override awake() {
        seen.push(this.label);
      }
    }
    class Widget extends Group {
      readonly inner = new Group();
      override onLoad(): void {
        this.add(this.inner);
        this.inner.addComponent(Reader);
      }
    }

    await SceneManager.load(
      sceneOf((scene) => {
        scene.instantiate(Widget, {}, (widget) => {
          widget.inner.getComponent(Reader)!.label = 'overridden';
        });
      }),
    );
    expect(seen).toEqual(['overridden']);
  });
});

describe('CameraFit', () => {
  /** The component reads the canvas, so a test has to give it one to read. */
  function withCanvas(width: number, height: number, body: () => void): void {
    const engine = { canvas: { clientWidth: width, clientHeight: height } } as unknown as Engine;
    const previous = Engine.current;
    Engine.current = engine;
    try {
      body();
    } finally {
      Engine.current = previous;
    }
  }

  it('derives an orthographic frustum from the frame it must keep on screen', () => {
    const camera = new OrthographicCamera();
    const fit = camera.addComponent(CameraFit, { mode: 'contain', width: 20, height: 10 });

    // Wider than the frame: the height decides, and the extra width is slack.
    withCanvas(400, 100, () => expect(fit.fit()).toBe(true));
    expect(camera.top).toBeCloseTo(5);
    expect(camera.right).toBeCloseTo(20);

    // Narrower: the width no longer fits at that height, so the view grows vertically.
    withCanvas(100, 100, () => fit.fit());
    expect(camera.top).toBeCloseTo(10);
    expect(camera.right).toBeCloseTo(10);
  });

  it('derives a perspective fov from the distance to the frame', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 10;
    const fit = camera.addComponent(CameraFit, { mode: 'height', height: 10 });

    withCanvas(100, 100, () => fit.fit());
    // A 10-unit frame at 10 units away is 2·atan(0.5) ≈ 53.13°.
    expect(camera.fov).toBeCloseTo(53.13, 1);
  });

  it('does nothing without a canvas to measure', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    const fit = camera.addComponent(CameraFit, { mode: 'contain', width: 10, height: 10 });
    expect(fit.fit()).toBe(false);
    expect(camera.fov).toBe(50);
  });
});

describe('render settings', () => {
  /** A renderer stands in for the real one: everything applied here is a property write. */
  function fakeRenderer() {
    return {
      toneMapping: NoToneMapping,
      toneMappingExposure: 1,
      shadowMap: { enabled: false },
    } as unknown as WebGLRenderer;
  }

  class Grade extends Effect {
    exposure = 1.4;
    override apply({ renderer }: { renderer: WebGLRenderer }): void {
      renderer.toneMappingExposure = this.exposure;
    }
  }

  it('are an asset a scene names, not properties grafted onto Scene', () => {
    const scene = new Scene();
    // Nothing invented on the three.js class: the look is one value, and a scene without one
    // gets three.js's defaults.
    expect(scene.render).toBeNull();
    expect(scene.fog).toBeNull();

    const settings = new RenderSettings([new Grade()], new Fog(new Color(0x05070d), 20, 46));
    scene.render = settings;

    const renderer = fakeRenderer();
    expect(new RenderState().apply(renderer, scene)).toBe(true);
    expect(renderer.toneMappingExposure).toBe(1.4);
    expect((scene.fog as Fog).far).toBe(46);
  });

  it('reach every scene that shares them, not only the first', () => {
    // Three levels naming one render document share one `RenderSettings` instance. Remembering
    // the settings alone and skipping when they match left every level after the first with no
    // fog, because `scene.fog` is state on the *scene*.
    const settings = new RenderSettings([], new Fog(new Color(0x05070d), 20, 46));
    const first = new Scene();
    const second = new Scene();
    first.render = settings;
    second.render = settings;

    const state = new RenderState();
    const renderer = fakeRenderer();
    expect(state.apply(renderer, first)).toBe(true);
    // The scene changed, so the settings are applied again — but the pass chain, which depends
    // only on the document, is not rebuilt.
    expect(state.apply(renderer, second)).toBe(false);
    expect((second.fog as Fog).far).toBe(46);
    // Nothing changed at all: the third call is the one that must do no work.
    expect(state.apply(renderer, second)).toBe(false);
  });

  it('restore the defaults for a scene that names none', () => {
    const state = new RenderState();
    const renderer = fakeRenderer();
    const lit = new Scene();
    lit.render = new RenderSettings([new Grade()], new Fog(new Color(0x000000), 1, 2));
    state.apply(renderer, lit);

    const plain = new Scene();
    state.apply(renderer, plain);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(plain.fog).toBeNull();
  });
});
