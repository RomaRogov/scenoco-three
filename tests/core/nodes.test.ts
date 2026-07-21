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
  ValueType,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';

/** Find a node by its DSL scene id (Object3D.sceneId) — replaces the old name-based getObjectByName. */
function bySceneId(root: import('three').Object3D, id: string): import('three').Object3D | undefined {
  let found: import('three').Object3D | undefined;
  root.traverse((o) => { if (!found && o.sceneId === id) found = o; });
  return found;
}

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
    @property({ type: ValueType.Float, description: 'knot radius' }) radius = 1;
    attach(ctx: AttachContext): void { ctx.node.add(new Mesh(new TorusKnotGeometry(this.radius))); }
  }
  void WidgetNode;
  void KnotAttachment;
  afterAll(() => { unregisterNode('Widget'); unregisterAttachment('Knot'); });

  it('validates a custom attachment only on its target node, enforces required groups, and instantiates', () => {
    expect(compileSceneXml(`<Scene><Widget id="w"><Attachments><Knot radius="2" /></Attachments></Widget></Scene>`).ok).toBe(true);
    const wrong = compileSceneXml(`<Scene><Mesh id="m"><Attachments><BoxGeometry /><Knot /></Attachments></Mesh></Scene>`);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.diagnostics.some((d) => d.code === 'attachment-wrong-target')).toBe(true);
    const missing = compileSceneXml(`<Scene><Widget id="w" /></Scene>`);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0]!.code).toBe('missing-required-attachment');

    const widget = bySceneId(instantiateScene(compile(`<Scene><Widget id="w"><Attachments><Knot radius="2" /></Attachments></Widget></Scene>`)).root, 'w')!;
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
        <Line id="line"><Attachments><BoxGeometry /><LineBasicMaterial color="#ff0000" /></Attachments></Line>
        <Points id="pts"><Attachments><SphereGeometry /><PointsMaterial size="3" /></Attachments></Points>
        <Sprite id="spr"><Attachments><SpriteMaterial color="#00ff00" /></Attachments></Sprite>
      </Scene>`),
    );
    expect(bySceneId(live.root, 'spot')).toBeInstanceOf(SpotLight);
    expect((bySceneId(live.root, 'spot') as SpotLight).intensity).toBe(4);
    expect(bySceneId(live.root, 'ortho')).toBeInstanceOf(OrthographicCamera);
    expect(bySceneId(live.root, 'line')).toBeInstanceOf(Line);
    expect((bySceneId(live.root, 'pts') as Points).material).toBeInstanceOf(PointsMaterial);
    expect((bySceneId(live.root, 'spr') as Sprite).material).toBeInstanceOf(SpriteMaterial);

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
    engine.loadScene(compile(`<Scene><Attachments><Fog color="#112233" near="1" far="20" /><Background color="#445566" /></Attachments></Scene>`));
    expect((engine.scene.fog as Fog).far).toBe(20);
    expect((engine.scene.background as Color).getHex()).toBe(0x445566);
    engine.loadScene(compile(`<Scene><Mesh id="m"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`));
    expect(engine.scene.fog).toBeNull();
    expect(engine.scene.background).toBeNull();
    engine.dispose();
  });

  it('maps the DSL id to sceneId (not Object3D.name), and findObject/index resolve by it', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><Mesh id="hero"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`));
    const hero = engine.findObject('hero')!;
    expect(hero).toBeInstanceOf(Mesh);
    expect(hero.sceneId).toBe('hero'); // dedicated field carries the id
    expect(hero.name).toBe(''); // Three's `name` is left free, not overloaded
    engine.dispose();
  });

  it('authors eulerAngles in degrees (no build-time conversion) and exposes a live degrees ⇄ radians view', () => {
    const engine = new Engine();
    engine.loadScene(compile(`<Scene><Mesh id="m" eulerAngles="0 90 0"><Attachments><BoxGeometry /></Attachments></Mesh></Scene>`));
    const m = engine.findObject('m')!;
    // Runtime `rotation` is radians; the `eulerAngles` view reports degrees.
    expect(m.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(m.eulerAngles.y).toBeCloseTo(90);
    // Writing through either representation is visible in the other (no drift).
    m.eulerAngles.x = 45;
    expect(m.rotation.x).toBeCloseTo(Math.PI / 4);
    m.rotation.z = Math.PI;
    expect(m.eulerAngles.z).toBeCloseTo(180);
    engine.dispose();
  });
});
