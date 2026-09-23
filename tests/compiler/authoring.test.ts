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

/**
 * The authoring surface a document has beyond "a tree of nodes": overriding a spawned prefab,
 * settings on the scene itself, a system that can see the scene, and lists of anything.
 *
 * Every one of these existed as a gap found by writing a real game against the compiler, so the
 * cases here are the ones that game actually needed.
 */
let fixture: Fixture;
let model: ProjectModel;

/** The prefab a scene spawns, and what it exposes to an `<Override>`. */
const BRICK: AssetImport = {
  module: './brick.prefab.js',
  name: 'BrickPrefab',
  kind: 'prefab',
  surface: {
    ids: new Map([
      ['root', { tag: 'Mesh', kind: 'node', root: true }],
      ['label', { tag: 'Mesh', kind: 'node' }],
      ['brick', { tag: 'Brick', kind: 'component' }],
      ['inner', { tag: 'Prefab', kind: 'prefab' }],
    ]),
  },
};

const ASSETS: Record<string, AssetImport> = {
  'cube.asset.xml': { module: './cube.asset.js', name: 'cube', kind: 'value' },
  'brick.asset.xml': { module: './brick.asset.js', name: 'brick', kind: 'value' },
  'hard.asset.xml': { module: './hard.asset.js', name: 'hard', kind: 'value' },
  'brick.prefab.xml': BRICK,
  'level-2.scene.xml': { module: './level-2.scene.js', name: 'Level2Scene', kind: 'scene' },
  'neon.render.xml': { module: './neon.render.js', name: 'neon', kind: 'value' },
};

beforeAll(() => {
  fixture = makeFixture('authoring');
  fixture.write(
    'components.ts',
    `import { Component, System, type PrefabType, type SceneType } from '@scenoco-three/core';
import { Color, Mesh, Object3D, Vector3 } from 'three';

/** Scores a brick. */
export class Brick extends Component {
  points = 10;
  hits = 1;
  label = 'brick';
  /**
   * Set when the ball first touches it.
   * @nonSerialized
   */
  cracked = false;
}

/** The rules of the game — a scene service that reads the scene it serves. */
export class Rules extends System {
  goal!: Object3D;
  spawns: Object3D[] = [];
  pointsPerHit = 50;
  nextLevel!: SceneType;
}

/** Lays out the repetitive half of a level, which is a loop rather than sixty elements. */
export class Field extends Component {
  cell!: PrefabType;
  cells: PrefabType[] = [];
  columns = 7;
}

export class Palette extends Component {
  colors: Color[] = [];
  waypoints: Vector3[] = [];
  bricks: Mesh[] = [];
  speeds: number[] = [];
  labels: string[] = [];
  flags: boolean[] = [];
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

function emit(kind: 'scene' | 'prefab', xml: string, name = 'GeneratedScene') {
  const source = `${name}.${kind}.xml`;
  const parsed = parseDocument(xml, source);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join('\n'));
  return emitGraph(parsed.root, { kind, name, source, model, resolveAsset: (href) => ASSETS[href] });
}

const codes = (diagnostics: SncDiagnostic[]) => diagnostics.map((d) => d.code);

describe('prefab overrides', () => {
  it('patches a component field, a node property and the placement of one spawn', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Prefab src="brick.prefab.xml" position="x: -4">
           <Override target="#brick" hits="3" label="hard" />
           <Override target="#label" material="hard.asset.xml" visible="false" />
           <Override target="#root" scale="2" />
         </Prefab>
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    // Applied in `instantiate`'s configure callback: after the prefab built itself, before
    // anything in it woke up.
    expect(code).toContain('this.instantiate(BrickPrefab, { position: new Vector3(-4, 0, 0) }, (brickPrefab) => {');
    expect(code).toContain('brickPrefab.brick.hits = 3;');
    expect(code).toContain("brickPrefab.brick.label = 'hard';");
    expect(code).toContain('brickPrefab.label.material = hard;');
    expect(code).toContain('brickPrefab.label.visible = false;');
    // The root of the prefab *is* the instance, so it has no field of its own.
    expect(code).toContain('brickPrefab.scale.setScalar(2);');
  });

  it('names the near miss when a target is not an id the prefab declares', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Prefab src="brick.prefab.xml"><Override target="#lable" points="1" /></Prefab></Scene>`,
    );
    expect(codes(diagnostics)).toEqual(['unknown-target']);
    expect(diagnostics[0]!.message).toContain('#label');
  });

  it('checks an overridden value against the field it lands on', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Prefab src="brick.prefab.xml"><Override target="#brick" hits="lots" /></Prefab></Scene>`,
    );
    expect(codes(diagnostics)).toEqual(['bad-number']);
  });

  it('suggests the right field when an override misspells one', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Prefab src="brick.prefab.xml"><Override target="#brick" pionts="5" /></Prefab></Scene>`,
    );
    expect(codes(diagnostics)).toEqual(['unknown-attribute']);
    expect(diagnostics[0]!.message).toContain('points');
  });

  it('overrides a constructor attribute too, and refreshes a camera that needs it', () => {
    // `<Mesh geometry material>` is passed to `new Mesh(…)` in the prefab, and swapping the
    // material of one spawn is the most ordinary override there is.
    const swap = emit(
      'scene',
      `<Scene><Prefab src="brick.prefab.xml"><Override target="#label" geometry="cube.asset.xml" /></Prefab></Scene>`,
    );
    expect(swap.diagnostics).toEqual([]);
    expect(swap.code).toContain('.label.geometry = cube;');

    const camera: AssetImport = {
      ...BRICK,
      surface: { ids: new Map([['eye', { tag: 'PerspectiveCamera', kind: 'node' }]]) },
    };
    ASSETS['camera.prefab.xml'] = camera;
    const view = emit(
      'scene',
      `<Scene><Prefab src="camera.prefab.xml"><Override target="#eye" fov="35" /></Prefab></Scene>`,
    );
    expect(view.diagnostics).toEqual([]);
    expect(view.code).toContain('.eye.updateProjectionMatrix();');
  });

  it('rejects an override with nothing to say, and one outside a spawn', () => {
    expect(
      codes(emit('scene', `<Scene><Prefab src="brick.prefab.xml"><Override target="#brick" /></Prefab></Scene>`).diagnostics),
    ).toEqual(['empty-override']);
    expect(codes(emit('scene', `<Scene><Override target="#brick" hits="2" /></Scene>`).diagnostics)).toEqual([
      'misplaced-override',
    ]);
  });

  it('keeps the callback in its own argument when the spawn has no placement', () => {
    // `instantiate(type, init, configure)`: a spawn with overrides and nothing else must not
    // slide the callback into `init`'s slot, where it would be applied as settings.
    const { code } = emit(
      'scene',
      `<Scene><Prefab src="brick.prefab.xml"><Override target="#brick" hits="2" /></Prefab></Scene>`,
    );
    expect(code).toContain('this.instantiate(BrickPrefab, undefined, (brickPrefab) => {');
  });

  it('adds a component to one spawned instance without touching the prefab', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Prefab src="brick.prefab.xml" id="b1">
           <Components><Brick points="99" /></Components>
         </Prefab>
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('this.b1.addComponent(Brick, { points: 99 });');
  });
});

describe('the scene itself', () => {
  it('takes the properties THREE.Scene has, plus the engine\'s four, and nothing else', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene background="#05070d" backgroundIntensity="0.8"
              render="neon.render.xml" dontDestroyOnLoad="true" disposeOnUnload="false" />`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('this.background = new Color(0x05070d);');
    expect(code).toContain('this.backgroundIntensity = 0.8;');
    expect(code).toContain('this.render = neon;');
    expect(code).toContain('this.dontDestroyOnLoad = true;');
    expect(code).toContain('this.disposeOnUnload = false;');

    const bad = emit('scene', `<Scene backgroud="#05070d" />`);
    expect(codes(bad.diagnostics)).toEqual(['unknown-attribute']);
    expect(bad.diagnostics[0]!.message).toContain('background');
  });

  it('has no attribute for what the renderer does — that is a render document', () => {
    // `scene.bloom` and `scene.toneMapping` do not exist in three.js. They were properties this
    // compiler grafted on, indistinguishable from the real ones, and `bloom="0"` was a value
    // that meant "off" while `bloomRadius` sat beside it doing nothing.
    const { diagnostics } = emit('scene', `<Scene bloom="0.75" toneMapping="ACESFilmicToneMapping" />`);
    expect(codes(diagnostics)).toEqual(['unknown-attribute', 'unknown-attribute']);
  });

  it('reads a background that is an image as an asset rather than a colour', () => {
    const { code, diagnostics } = emit('scene', `<Scene background="brick.asset.xml" />`);
    // The union is resolved by the text: a path is an asset, `#rrggbb` is a colour.
    expect(diagnostics).toEqual([]);
    expect(code).toContain('this.background = brick;');
  });

  it('refuses a bare non-node element, because every bare element here is a node', () => {
    // A scene document *is* the tree. `<Fog>` is not an `Object3D`, so it has no place in it —
    // and the diagnostic says where it does belong rather than only that it does not fit.
    const { diagnostics } = emit('scene', `<Scene><Fog color="#000" /></Scene>`);
    expect(codes(diagnostics)).toEqual(['misplaced-fog']);
    expect(diagnostics[0]!.message).toContain('<Render>');
  });
});

describe('systems', () => {
  it('adds the system before the tree and hands it its nodes after', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Systems><Rules goal="#goal" spawns="[#a, #b]" pointsPerHit="25" nextLevel="level-2.scene.xml" /></Systems>
         <Group id="goal" />
         <Group id="a" />
         <Group id="b" />
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    const addedAt = code!.indexOf('addSystem(Rules');
    const builtAt = code!.indexOf('this.goal = new Group()');
    const wiredAt = code!.indexOf('.goal = this.goal;');
    // A component woken by a spawned prefab must find the configured system, so the system is
    // added first; its nodes cannot exist yet, so those land after the tree.
    expect(addedAt).toBeLessThan(builtAt);
    expect(builtAt).toBeLessThan(wiredAt);
    expect(code).toContain('const rules = this.addSystem(Rules, { pointsPerHit: 25, nextLevel: Level2Scene });');
    expect(code).toContain('rules.spawns = [this.a, this.b];');
  });
});

describe('lists and references', () => {
  it('takes a bracketed list of any value, not only of references', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Group id="b1" />
         <Group id="b2">
           <Components>
             <Palette colors="[#38bdf8, #f472b6]" waypoints="[x: 0; y: 1, x: 2; y: 3]" bricks="[#b1, #b2]" />
           </Components>
         </Group>
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('colors: [new Color(0x38bdf8), new Color(0xf472b6)]');
    expect(code).toContain('waypoints: [new Vector3(0, 1, 0), new Vector3(2, 3, 0)]');
    expect(code).toContain('bricks: [this.b1, this.b2]');
  });

  it('takes a list of plain values too, and an empty one', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Group>
           <Components>
             <Palette speeds="[1, 2.5, -3]" labels="[red, green]" flags="[true, false]" colors="[]" />
           </Components>
         </Group>
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('speeds: [1, 2.5, -3]');
    expect(code).toContain("labels: ['red', 'green']");
    expect(code).toContain('flags: [true, false]');
    expect(code).toContain('colors: []');
  });

  it('reports the entry that is wrong, not the list', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene><Group><Components><Palette speeds="[1, fast]" /></Components></Group></Scene>`,
    );
    expect(codes(diagnostics)).toEqual(['bad-number']);
    expect(diagnostics[0]!.message).toContain('fast');
  });

  it('fills a PrefabType field with a path, so a component can spawn what a document names', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene>
         <Group>
           <Components>
             <Field cell="brick.prefab.xml" cells="[brick.prefab.xml]" columns="9" />
           </Components>
         </Group>
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    // The class itself, imported — the same value `<Prefab src>` spawns, reached the same way a
    // geometry or a scene is. A component holding it can `instantiate` it as many times as it
    // likes, which is where a grid of bricks belongs.
    expect(code).toContain('node1.addComponent(Field, { cell: BrickPrefab, cells: [BrickPrefab], columns: 9 })');
  });

  it('spawns a prefab and loads a scene, and will not confuse the two', () => {
    const { diagnostics } = emit('scene', `<Scene><Prefab src="level-2.scene.xml" /></Scene>`);
    expect(codes(diagnostics)).toEqual(['not-a-prefab']);
    expect(diagnostics[0]!.message).toContain('SceneManager.load');
  });
});

describe('surviving a scene load', () => {
  it('moves a node to the persistent scene, and marks a scene exempt', () => {
    const { code, diagnostics } = emit(
      'scene',
      `<Scene dontDestroyOnLoad="true">
         <Group id="hud" dontDestroyOnLoad="true" />
         <Prefab src="brick.prefab.xml" id="b1" dontDestroyOnLoad="true" />
       </Scene>`,
    );
    expect(diagnostics).toEqual([]);
    expect(code).toContain('SceneManager.dontDestroyOnLoad(this.hud);');
    expect(code).toContain('SceneManager.dontDestroyOnLoad(this.b1);');
    expect(code).toContain('this.dontDestroyOnLoad = true;');
  });

  it('refuses to let a prefab decide its own lifetime', () => {
    expect(
      codes(emit('prefab', `<Group dontDestroyOnLoad="true" />`, 'ForeverPrefab').diagnostics),
    ).toEqual(['persist-in-prefab']);
  });
});

describe('a field the class keeps out of documents', () => {
  it('is an error to write, naming the marker — on the component and through an override', () => {
    const { diagnostics } = emit(
      'scene',
      `<Scene>
         <Mesh><Components><Brick cracked="true" /></Components></Mesh>
         <Prefab src="brick.prefab.xml"><Override target="#brick" cracked="true" /></Prefab>
       </Scene>`,
    );
    expect(codes(diagnostics)).toEqual(['non-serialized', 'non-serialized']);
    expect(diagnostics[0]!.message).toContain('Brick marks it @nonSerialized');
  });
});
