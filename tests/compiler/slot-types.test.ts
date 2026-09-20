import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../packages/compiler/src/index.js';
import { makeFixture, type Fixture } from './fixture.js';

/**
 * A slot whose type is not what the document points it at — each once compiled, or was answered
 * with advice that led nowhere.
 */
let fixture: Fixture;

beforeAll(() => {
  fixture = makeFixture('slot-types', { ui: true, particles: true });
  fixture.write('tags.ts', `import '@scenoco-three/ui';\nimport '@scenoco-three/particles';\n`);
  fixture.write(
    'hud.ts',
    `import { Component, type PrefabType } from '@scenoco-three/core';
import type { Object3D } from 'three';

/** \`Text\` with no import: the browser's own DOM \`Text\`, not the ui tag. */
export class Hud extends Component {
  label!: Text;
}

export class Burster extends Component {
  burst!: PrefabType;
}

export class Spawner extends Component {
  template!: Object3D;
}
`,
  );
  fixture.writeXml('assets/vfx/pop.particle.xml', '<ParticleEffect />');
});
afterAll(() => fixture.dispose());

function messages(scene: string): string[] {
  fixture.writeXml('assets/scenes/main.scene.xml', scene);
  return build({ root: fixture.dir, tsconfig: fixture.tsconfig, dryRun: true }).diagnostics.map(
    (d) => `${d.code}  ${d.message}`,
  );
}

describe('a slot typed as something the document cannot point at', () => {
  it('names the tag’s module when the type name reached a global of the same name', () => {
    const said = messages(`<Scene>
  <Group id="g"><Components><Hud label="#g" /></Components></Group>
</Scene>`);
    expect(said).toContain(
      "unsupported-type  label is typed Text, but that Text is not the <Text> tag — with no import the name " +
        "reaches another class of that name, such as the browser's. Import the tag's: import { Text } from '@scenoco-three/ui'.",
    );
  });

  it('says a path is not a node reference, and what a path is written into', () => {
    const said = messages(`<Scene>
  <Group id="g"><Components><Spawner template="../prefabs/core.prefab.xml" /></Components></Group>
</Scene>`);
    expect(said).toContain(
      'wrong-slot  template="../prefabs/core.prefab.xml" is a path, and template is typed Object3D — a node in ' +
        "this document, written '#id'. To spawn a prefab from a path, type the field PrefabType.",
    );
  });

  it('refuses a document of another kind at the attribute, rather than in generated code', () => {
    const said = messages(`<Scene>
  <Group id="g"><Components><Burster burst="../vfx/pop.particle.xml" /></Components></Group>
</Scene>`);
    expect(said).toContain(
      'wrong-asset  burst="../vfx/pop.particle.xml" is a ParticleEffect document, and burst is typed PrefabType. ' +
        'Type the field ParticleEffect to hold this one, or point it at a .prefab.xml.',
    );
  });
});
