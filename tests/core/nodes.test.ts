import { afterAll, describe, expect, it } from 'vitest';
import {
  MeshStandardMaterial,
  BufferGeometry,
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
  allAttachmentDefs,
  detachAttachment,
  componentAcceptsNode,
  getNodeDef,
  Registry,
  Component,
  component,
  target,
} from '@scenoco-three/core';
import { bundleScene, compileSceneXml } from '@scenoco-three/compiler';
import { MeshTinter } from '../fixtures/components/MeshTinter.js';
import { Rotator } from '../fixtures/components/Rotator.js';

// Registered by importing them.
void MeshTinter;
void Rotator;

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
  @attachment({ name: 'Knot', description: 'torus-knot shape', target: Group, group: 'shape', required: true })
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
        <OrthographicCamera id="ortho" fit="none" />
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
    engine.loadScene(bundleScene(compile(`<Scene><PerspectiveCamera id="Main" fov="42" fit="none" /></Scene>`)));
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

describe('attachment families', () => {
  it('derives group, target and cardinality from the family base class', () => {
    // `group` is no longer declared anywhere: it comes from the nearest Attachment
    // subclass in the prototype chain (GeometryAttachment → 'geometry'), and an
    // attachment extending Attachment directly is its own family (Background →
    // 'background'). These strings are published in scene-api.json and the XSD, so
    // pin them — a class rename must not silently reshape the schema.
    const groups = new Map(allAttachmentDefs().map((d) => [d.tag, d.group]));
    expect(groups.get('BoxGeometry')).toBe('geometry');
    expect(groups.get('MeshStandardMaterial')).toBe('material');
    expect(groups.get('Fog')).toBe('fog');
    expect(groups.get('FogExp2')).toBe('fog');
    expect(groups.get('Background')).toBe('background'); // its own family

    // Targets and cardinality are inherited from the family, declared once.
    const box = allAttachmentDefs().find((d) => d.tag === 'BoxGeometry')!;
    expect(box.required).toBe(true);
    expect(box.unique).toBe(true);
    expect(box.target).toEqual([Mesh, Line, Points]);

    const mat = allAttachmentDefs().find((d) => d.tag === 'MeshStandardMaterial')!;
    expect(mat.required).toBe(false); // the family declares no `required`
  });
});

describe('attachment family reset', () => {
  it('restores the right host property for every node type the family targets', () => {
    // The family targets Mesh | Line | Points (geometry) and those plus Sprite
    // (material) — the reset has to be correct for each, not just for Mesh.
    for (const host of [new Mesh(), new Line(), new Points()]) {
      host.geometry = new TorusKnotGeometry(2);
      detachAttachment(host, 'BoxGeometry');
      expect(host.geometry).toBeInstanceOf(BufferGeometry);
      expect(host.geometry).not.toBeInstanceOf(TorusKnotGeometry);
    }

    // A Sprite renders only with a SpriteMaterial; a mesh material makes it vanish.
    const sprite = new Sprite(new SpriteMaterial({ color: 0x00ff00 }));
    detachAttachment(sprite, 'SpriteMaterial');
    expect(sprite.material).toBeInstanceOf(SpriteMaterial);

    const mesh = new Mesh();
    detachAttachment(mesh, 'MeshStandardMaterial');
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
  });
});

describe('component node-type constraint', () => {
  it('is absent by default, and subclass-aware when a component declares one', () => {
    // The normal case: no `static target`, so the component goes on any node.
    const rotator = Registry.getComponent('Rotator')!.meta;
    expect(rotator.target).toBeUndefined();
    expect(componentAcceptsNode(rotator.target, getNodeDef('Group')!)).toBe(true);
    expect(componentAcceptsNode(rotator.target, getNodeDef('PointLight')!)).toBe(true);

    // A component that reads `this.node.material` declares `@target(Mesh)`, which
    // the registry resolves from the class (the generic itself is erased).
    const tinter = Registry.getComponent('MeshTinter')!.meta;
    expect(tinter.target).toBe(Mesh);
    expect(componentAcceptsNode(tinter.target, getNodeDef('Mesh')!)).toBe(true);
    // Subclass-aware, exactly like attachment targeting.
    expect(componentAcceptsNode(tinter.target, getNodeDef('SkinnedMesh')!)).toBe(true);
    expect(componentAcceptsNode(tinter.target, getNodeDef('Group')!)).toBe(false);
    expect(componentAcceptsNode(tinter.target, getNodeDef('PointLight')!)).toBe(false);
  });
});

describe('@target decorator', () => {
  it('works above or below @component — decorator order must not change behaviour', () => {
    // Legacy decorators apply bottom-up, so `@component` registers before anything
    // written above it. The registry therefore reads `target` from the class on
    // access; if it snapshotted at registration, the first case below would be
    // silently unconstrained — and above is exactly where Unity puts its attributes.
    @target(Mesh)
    @component({ name: 'TargetAbove', description: 'target declared above component' })
    class Above extends Component<Mesh> {}

    @component({ name: 'TargetBelow', description: 'target declared below component' })
    @target(Mesh)
    class Below extends Component<Mesh> {}

    void Above;
    void Below;
    expect(Registry.getComponent('TargetAbove')!.meta.target).toBe(Mesh);
    expect(Registry.getComponent('TargetBelow')!.meta.target).toBe(Mesh);

    Registry.unregisterComponent('TargetAbove');
    Registry.unregisterComponent('TargetBelow');
  });

  it('accepts several node classes', () => {
    @target(Mesh, Line)
    @component({ name: 'MultiTarget', description: 'accepts meshes and lines' })
    class Multi extends Component {}
    void Multi;

    const meta = Registry.getComponent('MultiTarget')!.meta;
    expect(componentAcceptsNode(meta.target, getNodeDef('Mesh')!)).toBe(true);
    expect(componentAcceptsNode(meta.target, getNodeDef('Line')!)).toBe(true);
    expect(componentAcceptsNode(meta.target, getNodeDef('Group')!)).toBe(false);
    Registry.unregisterComponent('MultiTarget');
  });
});
