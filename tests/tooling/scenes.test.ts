import { describe, expect, it } from 'vitest';
import { checkScene } from '@scenoco-three/tools';

describe('a .tsx file is a scene', () => {
  it('lets a scene declare — imports, constants, factories with refs — and refuses what runs, saying instead what to write', () => {
    const fine = `
      import { Group, Mesh } from 'three';
      const LANES = [-2, 0, 2];
      const letter = { font: new Font(helvetiker), size: 1.6 };
      const tree = sharedModel('/models/tree.glb', { castShadow: false });
      export const Tree = prefab(tree);
      export const Rock = prefab(sharedModel('/models/rock.glb'));
      export const Main = () => {
        const hero = ref<Mesh>();
        return <Group><Rigidbody constraints={RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY} /><Mesh ref={hero} rotation={[-Math.PI / 2, 0, 0]} position={[LANES[0] ?? 0, 1, 0]} /></Group>;
      };
      export const Coin = prefab(() => <Mesh />);`;
    expect(checkScene('fine.tsx', fine.replace('LANES[0] ?? 0', '0'))).toEqual([]);

    const bad = `export const Bad = () => <Group>{[0, 1].map((i) => <Mesh key={i} />)}{on && <Mesh />}<Mesh onClick={() => 1} /><Mesh args={[new Box3()]} /></Group>;
      const later = sharedModel(() => '/x.glb');
      export const Inside = () => <Mesh material-map={sharedTexture('/wood.png')} />;`;
    const problems = checkScene('bad.tsx', bad);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toMatch(/^bad\.tsx:1:\d+ {2}a scene has no loops — .*instantiate\(Prefab\)/);
    expect(problems[1]).toMatch(/no branches/);
    expect(problems[2]).toMatch(/no handlers/);
    expect(problems[3]).toMatch(/in a constant above the scene/);
    // Made from data above the scene, a model is a declaration; made from a function, or inside a scene, it isn't.
    expect(problems[4]).toMatch(/no handlers/);
    expect(problems[5]).toMatch(/const tree = sharedModel\('\/models\/tree\.glb'\)/);
  });
});
