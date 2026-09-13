import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Workspace,
  emitGraph,
  parseDocument,
  scanComponents,
  scanEffects,
  scanSystems,
  scanTags,
  type AssetImport,
  type ProjectModel,
  type SncDiagnostic,
} from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

let fixture: Fixture;
let model: ProjectModel;

/** The generated assets a document may reference, standing in for a real project scan. */
const ASSETS: Record<string, AssetImport> = {
  'cube.asset.xml': { module: './cube.asset.js', name: 'cube', kind: 'asset' },
  'brick.asset.xml': { module: './brick.asset.js', name: 'brick', kind: 'asset' },
  'brick.prefab.xml': { module: './brick.prefab.js', name: 'Brick', kind: 'prefab' },
};

beforeAll(() => {
  fixture = makeFixture('graph');
  fixture.write(
    'components.ts',
    `import { Component, System } from '@scenoco-three/core';
import { Mesh, PointLight, Vector2 } from 'three';

/** A stand-in physics world. */
export class Physics2D extends System {
  gravity = new Vector2(0, -9.81);
  velocityIterations = 8;
}

/** Scores a brick. */
export class Brick extends Component {
  points = 10;
}

export class Ball extends Component {
  launchSpeed = 12;
  paddle!: Mesh;
  bricks: Mesh[] = [];
}

export class Flicker extends Component<PointLight> {
  rate = 3;
}
`,
  );
  model = Workspace.with(fixture.tsconfig, (w) => ({
    components: scanComponents(w),
    systems: scanSystems(w),
    effects: scanEffects(w),
    tags: scanTags(w),
  }));
});

afterAll(() => fixture.dispose());

function emit(kind: 'scene' | 'prefab', xml: string, name = 'Generated') {
  const source = `${name}.${kind}.xml`;
  const parsed = parseDocument(xml, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
  return emitGraph(parsed.root, {
    kind,
    name,
    source,
    model,
    resolveAsset: (href) => ASSETS[href],
  });
}

const codes = (diagnostics: SncDiagnostic[]) => diagnostics.map((d) => d.code);

describe('prefab documents', () => {
  it('roots the class at the authored node type, with no wrapper', () => {
    const { code, diagnostics } = emit(
      'prefab',
      `<Mesh geometry="cube.asset.xml" material="brick.asset.xml">
         <Components><Brick points="10" /></Components>
       </Mesh>`,
      'Brick',
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('export class Brick extends Mesh {');
    // The constructor is where geometry and material go: `instantiate` calls `new Brick()`, so
    // nothing can be passed in, and three.js reads some slots only at construction.
    expect(code).toContain('super(cube, brick);');
    expect(code).toContain('this.addComponent(Brick$2, { points: 10 });');
  });

  it('imports geometry and material as assets rather than building them inline', () => {
    const { code } = emit(
      'prefab',
      `<Mesh geometry="cube.asset.xml" material="brick.asset.xml" />`,
      'Brick',
    );
    expect(code).toContain(`import { cube } from './cube.asset.js';`);
    expect(code).toContain(`import { brick } from './brick.asset.js';`);
    // Nothing constructs a BoxGeometry here — that lives in its own asset, shared by everyone
    // who references it.
    expect(code).not.toContain('BoxGeometry');
  });

  it('gives every id’d child a typed field', () => {
    const { code } = emit(
      'prefab',
      `<Group>
         <Mesh id="body" geometry="cube.asset.xml" material="brick.asset.xml" />
         <PointLight id="glow" intensity="2" />
       </Group>`,
      'Lamp',
    );
    expect(code).toContain('body!: Mesh;');
    expect(code).toContain('glow!: PointLight;');
    expect(code).toContain('this.add(this.body);');
  });
});

describe('scene documents', () => {
  it('emits a Scene subclass that builds itself in onLoad', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <PerspectiveCamera id="cam" fov="45" near="0.1" far="200" position="y: 7; z: 20" />
       </Scene>`,
      'Breakout',
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('export class Breakout extends Scene {');
    expect(code).toContain('cam!: PerspectiveCamera;');
    expect(code).toContain('this.cam = new PerspectiveCamera(45, undefined, 0.1, 200);');
    expect(code).toContain('this.cam.position.copy(new Vector3(0, 7, 20));');
    expect(code).toContain('this.add(this.cam);');
  });

  it('resolves a reference to a node declared later in the document', () => {
    // The whole reason components are attached in a second pass.
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Mesh id="ball" geometry="cube.asset.xml" material="brick.asset.xml">
           <Components><Ball paddle="#paddle" bricks="[#b1, #b2]" /></Components>
         </Mesh>
         <Mesh id="paddle" geometry="cube.asset.xml" material="brick.asset.xml" />
         <Mesh id="b1" geometry="cube.asset.xml" material="brick.asset.xml" />
         <Mesh id="b2" geometry="cube.asset.xml" material="brick.asset.xml" />
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('paddle: this.paddle');
    expect(code).toContain('bricks: [this.b1, this.b2]');
  });

  it('spawns a prefab instance through instantiate, in degrees', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Prefab src="brick.prefab.xml" id="b1" position="x: -6.75; y: 12" eulerAngles="z: 90" scale="2" />
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      'this.b1 = this.instantiate(Brick, { position: new Vector3(-6.75, 12, 0), eulerAngles: new Vector3(0, 0, 90), scale: 2 });',
    );
  });

  it('names an anonymous node with a local const', () => {
    const { code } = emit('scene', `<Scene><AmbientLight intensity="0.5" /></Scene>`);
    expect(code).toContain('const node1 = new AmbientLight(undefined, 0.5);');
    expect(code).toContain('this.add(node1);');
  });
});

describe('systems', () => {
  it('emits a <Systems> block as addSystem calls', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Systems>
           <Physics2D gravity="x: 0; y: 0" velocityIterations="6" />
         </Systems>
         <Group id="root" />
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('this.addSystem(Physics2D, { gravity: new Vector2(0, 0), velocityIterations: 6 });');
  });

  it('adds systems before the tree, so a component finds the configured one', () => {
    // A body's `awake` calls `requireSystem(Physics2D)`. If the scene had not declared its
    // world yet, the component would silently create a default-gravity one.
    const { code } = emit(
      'scene',
      `<Scene>
         <Systems><Physics2D gravity="x: 0; y: 0" /></Systems>
         <Group id="root" />
       </Scene>`,
    );
    expect(code!.indexOf('addSystem')).toBeLessThan(code!.indexOf('new Group()'));
  });

  it('does not treat <Systems> as a node', () => {
    const { code, diagnostics } = emit('scene', `<Scene><Systems><Physics2D /></Systems></Scene>`);
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain('new Systems');
  });

  it('reports a system this project has no class for, with a suggestion', () => {
    const { diagnostics } = emit('scene', `<Scene><Systems><Physics3D /></Systems></Scene>`);
    expect(diagnostics[0]?.code).toBe('unknown-system');
    expect(diagnostics[0]?.message).toContain('Did you mean <Physics2D>?');
  });

  it('reports a system field that does not exist', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Systems><Physics2D gravtiy="x: 0; y: 0" /></Systems></Scene>`,
    );
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    expect(diagnostics[0]?.message).toContain('Did you mean "gravity"?');
  });
});

describe('diagnostics', () => {
  it('reports a reference to an id nothing declares', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group id="g"><Components><Ball paddle="#nope" /></Components></Group></Scene>`,
    );
    expect(codes(diagnostics)).toContain('unknown-id');
  });

  it('reports a duplicate id', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group id="g" /><Group id="g" /></Scene>`,
    );
    expect(codes(diagnostics)).toContain('duplicate-id');
  });

  it('reports a component field that does not exist, with a suggestion', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group><Components><Brick pionts="10" /></Components></Group></Scene>`,
    );
    expect(diagnostics[0]?.code).toBe('unknown-attribute');
    expect(diagnostics[0]?.message).toContain('Did you mean "points"?');
  });

  it('reports a component required field left unset', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group id="g"><Components><Ball /></Components></Group></Scene>`,
    );
    expect(codes(diagnostics)).toContain('missing-attribute');
  });

  it('reports a component put on the wrong kind of node', () => {
    // `Flicker extends Component<PointLight>` — a compile error in the generated file, caught
    // here at the XML line instead.
    const { diagnostics } = emit(
      'scene',
      `<Scene><Mesh id="m" geometry="cube.asset.xml" material="brick.asset.xml">
         <Components><Flicker rate="3" /></Components>
       </Mesh></Scene>`,
    );
    expect(codes(diagnostics)).toContain('wrong-host');
  });

  it('accepts that same component on the node it asked for', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><PointLight id="lamp"><Components><Flicker rate="3" /></Components></PointLight></Scene>`,
    );
    expect(diagnostics).toEqual([]);
  });

  it('reports an unknown tag with a suggestion', () => {
    const { diagnostics } = emit('scene', `<Scene><Msh /></Scene>`);
    expect(diagnostics[0]?.code).toBe('unknown-tag');
    expect(diagnostics[0]?.message).toContain('Did you mean <Mesh>?');
  });

  it('reports a scene document not rooted at <Scene>', () => {
    const { diagnostics } = emit('scene', `<Group />`);
    expect(diagnostics[0]?.code).toBe('bad-root');
  });
});
