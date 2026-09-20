import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A slot typed as a component, filled from the document.
 *
 * Two things were wrong. A reference to a component declared further down the document was passed
 * at `addComponent`, before that component existed: it compiled, and `start()` met `undefined`.
 * And `#id` of a *node* went into a component slot as the node itself, which `tsc` then reported
 * against the generated file. Unity's inspector takes the component off an object dropped on a
 * component field; so does this.
 */
let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('component-slots');
  fixture.write(
    'game.ts',
    `import { Component, System } from '@scenoco-three/core';

export class Score extends System {
  /** A system slot typed as a component — Unity's inspector reference to a Button. */
  gate!: Door;
}

export class Door extends Component {
  open = false;
}

export class Lever extends Component {
  door!: Door;
}
`,
  );
  // The two slots a model wrote on its way to a button reference: an import from a module that
  // does not export the class, and `any`.
  fixture.write(
    'switch.ts',
    `import { Component, type Object3D } from '@scenoco-three/core';

export class Switch extends Component {
  target!: Object3D;
  other!: any;
}
`,
  );
  // A colour with an opacity of its own, named after it — the pairing a UI panel has.
  fixture.write(
    'tint.ts',
    `import { Component } from '@scenoco-three/core';
import { Color } from 'three';

export class Tint extends Component {
  background = new Color();
  backgroundOpacity = 1;
}
`,
  );
});
afterAll(() => fixture.dispose());

function compile(scene: string): { code: string; diagnostics: BuildResult['diagnostics'] } {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  const result = build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true });
  const entry = [...result.files].find(([path]) => path.endsWith('main.scene.gen.ts'));
  return { code: entry?.[1] ?? '', diagnostics: result.diagnostics };
}

describe('a slot typed as a component', () => {
  it('is filled after every component exists, whatever order the document wrote them in', () => {
    const { code, diagnostics } = compile(`<Scene>
  <Group id="lever"><Components><Lever door="#frontDoor" /></Components></Group>
  <Group id="gate"><Components><Door id="frontDoor" /></Components></Group>
</Scene>`);
    expect(diagnostics).toEqual([]);
    const created = code.indexOf('this.frontDoor = this.gate.addComponent(Door)');
    const assigned = code.indexOf('.door = this.frontDoor;');
    expect(created).toBeGreaterThan(-1);
    expect(assigned).toBeGreaterThan(created);
  });

  it('takes the component off a node named by its id, as Unity’s inspector does', () => {
    const { code, diagnostics } = compile(`<Scene>
  <Group id="lever"><Components><Lever door="#gate" /></Components></Group>
  <Group id="gate"><Components><Door /></Components></Group>
</Scene>`);
    expect(diagnostics).toEqual([]);
    expect(code).toContain('.door = this.gate.getComponent(Door)!;');
  });

  it('says so at the attribute when that node carries no such component', () => {
    const { diagnostics } = compile(`<Scene>
  <Group id="lever"><Components><Lever door="#gate" /></Components></Group>
  <Group id="gate" />
</Scene>`);
    expect(diagnostics.map((d) => d.code)).toEqual(['wrong-slot']);
    expect(diagnostics[0]!.message).toContain('Add <Door /> to its <Components>');
  });
});

describe('a system’s slot', () => {
  it('reaches a component by the id written on the component itself', () => {
    // `<Button id="startBtn">` and `startButton="#startBtn"` on a system: the systems are emitted
    // first, and the component ids were not claimed yet, so it read "no node declares it".
    const { code, diagnostics } = compile(`<Scene>
  <Systems><Score gate="#gateDoor" /></Systems>
  <Group id="g"><Components><Door id="gateDoor" /></Components></Group>
</Scene>`);
    expect(diagnostics).toEqual([]);
    expect(code).toContain('.gate = this.gateDoor;');
  });


  it('is assigned after the components exist, so a component slot is not null', () => {
    // It used to be written between the tree and the components: `getComponent(Door)` read null,
    // silently, and the system met `undefined` in `start()`.
    const { code, diagnostics } = compile(`<Scene>
  <Systems><Score gate="#gate" /></Systems>
  <Group id="gate"><Components><Door /></Components></Group>
</Scene>`);
    expect(diagnostics).toEqual([]);
    const added = code.indexOf('.addComponent(Door)');
    const assigned = code.indexOf('.gate = this.gate.getComponent(Door)');
    expect(added).toBeGreaterThan(-1);
    expect(assigned).toBeGreaterThan(added);
  });
});

describe('a slot the document cannot fill', () => {
  it('names the import when the type does not resolve, and the fix when it is any', () => {
    const { diagnostics } = compile(`<Scene>
  <Group id="panel" />
  <Group id="wall"><Components><Switch target="#panel" other="#panel" /></Components></Group>
</Scene>`);
    const say = (field: string) => diagnostics.find((d) => d.message.startsWith(`${field} is typed`))?.message;
    expect(say('target')).toContain("does not resolve in that file — it comes from 'three': import { Object3D } from 'three'.");
    expect(say('other')).toContain("the class of the node (Mesh) or of the component it points at, written '#id'");
    expect(say('other')).toContain('or PrefabType for a prefab to spawn, written as its path');
  });
});

describe('an exact rewrite', () => {
  it('names the opacity beside the colour when the element has one, by the colour’s own name', () => {
    const { diagnostics } = compile(`<Scene>
  <Group id="g"><Components><Tint background="#00000080" /></Components></Group>
</Scene>`);
    expect(diagnostics[0]?.message).toContain('Write background="#000000" backgroundOpacity="0.5".');
  });
});

describe('a component where a system goes, and the other way round', () => {
  it('says which it is and where it goes', () => {
    const { diagnostics } = compile(`<Scene>
  <Systems><Door /></Systems>
  <Group id="g"><Components><Score /></Components></Group>
</Scene>`);
    const messages = diagnostics.map((d) => d.message);
    expect(messages).toContain("<Door> is a component, not a system: it goes in a node's <Components>, as <Mesh …><Components><Door /></Components></Mesh>.");
    expect(messages).toContain("<Score> is a system, not a component: it goes in the scene's <Systems>.");
  });
});


describe('a component written as a node, and a path written from the project root', () => {
  it('says where the component goes', () => {
    const { diagnostics } = compile(`<Scene><Door /></Scene>`);
    expect(diagnostics.map((d) => d.message)).toContain(
      "<Door> is a component, not a node: it goes in a node's <Components>, as <Mesh …><Components><Door /></Components></Mesh>.",
    );
  });

  it('hands back the path relative to the document when the file exists', () => {
    fixture.writeXml('assets/materials/glow.asset.xml', '<MeshBasicMaterial color="#ff8800" />');
    fixture.writeXml(
      'assets/prefabs/core.prefab.xml',
      '<Mesh material="assets/materials/glow.asset.xml" />',
    );
    const { diagnostics } = compile('<Scene />');
    const message = diagnostics.find((d) => d.code === 'unknown-asset')?.message;
    expect(message).toContain('Write material="../materials/glow.asset.xml"');

    // And written with no extension at all, as `../materials/glow`.
    fixture.writeXml('assets/prefabs/core.prefab.xml', '<Mesh material="../materials/glow" />');
    const bare = compile('<Scene />').diagnostics.find((d) => d.code === 'unknown-asset')?.message;
    expect(bare).toContain('Write material="../materials/glow.asset.xml"');
  });
});
