import { Mesh, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { Component, Engine, component } from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

const log: string[] = [];

@component({ name: 'OrderLast', order: 10, description: 'runs last' })
class OrderLast extends Component {
  override onLoad(): void {
    log.push('load:last');
  }
  override update(): void {
    log.push('update:last');
  }
}
@component({ name: 'OrderFirst', order: -10, description: 'runs first' })
class OrderFirst extends Component {
  override onLoad(): void {
    log.push('load:first');
  }
  override update(): void {
    log.push('update:first');
  }
}
@component({ name: 'OrderMid', description: 'runs in the middle' }) // default order 0
class OrderMid extends Component {
  override update(): void {
    log.push('update:mid');
  }
}

const compile = (xml: string) => {
  const r = compileSceneXml(xml);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.map((d) => d.message).join('; '));
  return r.scene;
};

describe('execution order (@component order)', () => {
  it('runs onLoad and update in ascending order regardless of declaration order', () => {
    log.length = 0;
    // Declared Last, First, Mid — execution must be First(-10), Mid(0), Last(10).
    const scene = compile(
      '<Scene><Group><Components><OrderLast /><OrderFirst /><OrderMid /></Components></Group></Scene>',
    );
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));
    engine.tick(1 / 60);

    expect(log).toEqual(['load:first', 'load:last', 'update:first', 'update:mid', 'update:last']);
    engine.dispose();
  });
});

describe('object id index (findObject)', () => {
  const scene = () => compile('<Scene><Group id="a"><Group id="b" /></Group></Scene>');

  it('finds scene objects, and undefined after destroy', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(scene()));
    const a = engine.findObject('a')!;
    expect(a).toBeDefined();
    expect(engine.findObject('b')).toBeDefined();

    engine.destroy(a);
    expect(engine.findObject('a')).toBeUndefined();
    expect(engine.findObject('b')).toBeUndefined(); // child went with it
    engine.dispose();
  });

  it('falls back to a traversal for objects added outside the engine', () => {
    const engine = new Engine();
    engine.loadScene(bundleScene(scene()));
    const manual = new Mesh();
    manual.name = 'manual';
    engine.scene.add(manual);
    expect(engine.findObject('manual')).toBe(manual); // not indexed, found via fallback
    engine.dispose();
  });
});

describe('camera priority', () => {
  it('orders cameras by priority ascending (render order); first declared is mainCamera', () => {
    const scene = compile(
      '<Scene><PerspectiveCamera id="main" position="0 0 5" /><PerspectiveCamera id="ui" priority="10" /></Scene>',
    );
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));

    expect(engine.cameras.length).toBe(2);
    expect(engine.cameras[0]).toBe(engine.findObject('main')); // priority 0 renders first
    expect(engine.cameras[1]).toBe(engine.findObject('ui')); // priority 10 renders last (on top)
    expect(engine.mainCamera).toBe(engine.findObject('main')); // first found → raycast/pointer camera
    engine.dispose();
  });

  it('an external mainCamera (not in the scene) is a render override — render matches raycast', () => {
    const scene = compile('<Scene><PerspectiveCamera id="game" position="0 0 5" /></Scene>');
    const engine = new Engine();
    engine.loadScene(bundleScene(scene));
    const renderList = () => (engine as unknown as { renderList(): unknown[] }).renderList();

    // A scene camera as mainCamera → renders the scene's camera list (the regular game case).
    expect(renderList()).toEqual(engine.cameras);

    // Point mainCamera at an external camera (e.g. the editor's free camera, never added to the
    // scene): the engine must render through IT — the same camera raycasting uses — not the game one.
    const editorCam = new PerspectiveCamera();
    engine.mainCamera = editorCam;
    expect(renderList()).toEqual([editorCam]);
    expect(engine.mainCamera).toBe(editorCam); // raycast() uses mainCamera → render & pick agree
    engine.dispose();
  });
});
