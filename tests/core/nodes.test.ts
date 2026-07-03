import { afterAll, describe, expect, it } from 'vitest';
import {
  Color,
  Fog,
  Group,
  Line,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TorusKnotGeometry,
} from 'three';
import {
  Attachment,
  Object3DNode,
  attachment,
  instantiateScene,
  node,
  property,
  unregisterAttachment,
  unregisterNode,
  Engine,
  type AttachContext,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

function compile(xml: string) {
  const result = compileSceneXml(xml);
  if (!result.ok) throw new Error(`unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  return result.scene;
}

// The tag system is extensible via the same idiom as components: a class + a
// class decorator + `@property` fields.
describe('tag registry — custom node/attachment', () => {
  @node({ name: 'Widget', description: 'A test-only node' })
  class WidgetNode extends Object3DNode {
    build(): Group { return new Group(); }
  }
  @attachment({ name: 'Knot', description: 'torus-knot shape', target: 'Widget', group: 'shape', required: true })
  class KnotAttachment extends Attachment {
    @property({ type: 'float', default: 1, description: 'knot radius' }) radius = 1;
    attach(ctx: AttachContext): void { ctx.node.add(new Mesh(new TorusKnotGeometry(this.radius))); }
  }
  void WidgetNode;
  void KnotAttachment;
  afterAll(() => { unregisterNode('Widget'); unregisterAttachment('Knot'); });

  it('validates a custom attachment only on its target node, enforces required groups, and instantiates', () => {
    expect(compileSceneXml(`<Scene><Widget id="w"><Knot radius="2" /></Widget></Scene>`).ok).toBe(true);
    const wrong = compileSceneXml(`<Scene><Mesh id="m"><BoxGeometry /><Knot /></Mesh></Scene>`);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.diagnostics.some((d) => d.code === 'attachment-wrong-target')).toBe(true);
    const missing = compileSceneXml(`<Scene><Widget id="w" /></Scene>`);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0]!.code).toBe('missing-required-attachment');

    const widget = instantiateScene(compile(`<Scene><Widget id="w"><Knot radius="2" /></Widget></Scene>`)).root.getObjectByName('w')!;
    expect(widget).toBeInstanceOf(Group);
    expect(widget.children.length).toBe(1); // the knot mesh ran
  });
});

describe('built-in nodes', () => {
  it('instantiates lights, cameras, lines, points, sprites; loadScene picks up the scene camera and clears it on unload', () => {
    const live = instantiateScene(
      compile(`<Scene>
        <SpotLight id="spot" intensity="4" />
        <OrthographicCamera id="ortho" />
        <Line id="line"><BoxGeometry /><LineBasicMaterial color="#ff0000" /></Line>
        <Points id="pts"><SphereGeometry /><PointsMaterial size="3" /></Points>
        <Sprite id="spr"><SpriteMaterial color="#00ff00" /></Sprite>
      </Scene>`),
    );
    expect(live.root.getObjectByName('spot')).toBeInstanceOf(SpotLight);
    expect((live.root.getObjectByName('spot') as SpotLight).intensity).toBe(4);
    expect(live.root.getObjectByName('ortho')).toBeInstanceOf(OrthographicCamera);
    expect(live.root.getObjectByName('line')).toBeInstanceOf(Line);
    expect((live.root.getObjectByName('pts') as Points).material).toBeInstanceOf(PointsMaterial);
    expect((live.root.getObjectByName('spr') as Sprite).material).toBeInstanceOf(SpriteMaterial);

    const engine = new Engine();
    engine.loadScene(bundleScene(compile(`<Scene><PerspectiveCamera id="Main" fov="42" /></Scene>`)));
    expect(engine.mainCamera).toBe(engine.findObject('Main'));
    expect((engine.mainCamera as PerspectiveCamera).fov).toBe(42);
    engine.disposeScene();
    expect(engine.mainCamera).toBeUndefined(); // no built-in fallback
    engine.dispose();
  });

  it('applies fog and background to the live THREE.Scene on load, clearing them on the next scene', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><Fog color="#112233" near="1" far="20" /><Background color="#445566" /></Scene>`));
    expect((engine.scene.fog as Fog).far).toBe(20);
    expect((engine.scene.background as Color).getHex()).toBe(0x445566);
    engine.loadScene(compile(`<Scene><Mesh id="m"><BoxGeometry /></Mesh></Scene>`));
    expect(engine.scene.fog).toBeNull();
    expect(engine.scene.background).toBeNull();
    engine.dispose();
  });
});
