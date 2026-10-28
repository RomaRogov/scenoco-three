import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';
import { Runtime, wake } from '@scenoco-three/core';
import { Behaviour, instantiate, prefab, ref, type Prefab, type Ref } from '@scenoco-three/core';
import { jsx } from '@scenoco-three/core/jsx-runtime';

const runtimes: Runtime[] = [];
afterEach(() => runtimes.splice(0).forEach((r) => r.dispose()));
function run(scene: Scene): Runtime {
  const runtime = new Runtime(scene);
  runtimes.push(runtime);
  wake(scene);
  return runtime;
}

class Aim extends Behaviour {
  target: Group | null = null;
  seen: Group | null = null;
  override awake() {
    this.seen = this.target;
  }
}

class Launcher extends Behaviour {
  shot: Prefab<Group> | null = null;
  fire(): Group {
    return instantiate(this.shot!, { parent: this.node });
  }
}

class Holder extends Behaviour {
  target: Ref<Group> = ref();
}

describe('TSX on three.js', () => {
  it('builds what it says: args, R3F-style values, dashed paths, attach — a node attached is in the scene too', () => {
    const light = ref<DirectionalLight>();
    const scene = (
      <Scene>
        <Color attach="background" args={['#0b1020']} />
        <Fog attach="fog" args={['#000000', 1, 9]} />
        <DirectionalLight ref={light} position={[1, 2, 3]} castShadow shadow-mapSize={[512, 256]}>
          <Object3D attach="target" position={[0, -1, 0]} />
        </DirectionalLight>
        <Mesh scale={2} rotation={[0, Math.PI, 0]}>
          <BoxGeometry args={[1, 2, 3]} />
          <MeshStandardMaterial color="#ff8800" />
        </Mesh>
      </Scene>
    ) as Scene;
    expect((scene.background as Color).getHexString()).toBe('0b1020');
    expect(scene.fog).toBeInstanceOf(Fog);
    expect(light.current!.position.toArray()).toEqual([1, 2, 3]);
    expect(light.current!.shadow.mapSize.toArray()).toEqual([512, 256]);
    // Its target is its child: it shines straight down from wherever it is moved.
    expect(light.current!.target.parent).toBe(light.current);
    scene.updateMatrixWorld();
    expect(light.current!.target.getWorldPosition(new Vector3()).toArray()).toEqual([1, 1, 3]);
    const mesh = scene.children[1] as Mesh<BoxGeometry, MeshStandardMaterial>;
    expect(mesh.scale.toArray()).toEqual([2, 2, 2]);
    expect(mesh.geometry.parameters).toMatchObject({ width: 1, height: 2, depth: 3 });
    expect(mesh.material.color.getHexString()).toBe('ff8800');
  });

  it('makes behaviours components of their parent, linked by typed refs read at awake', () => {
    const target = ref<Group>();
    const scene = (
      <Scene>
        <Group>
          <Aim target={target} />
        </Group>
        <Group ref={target} />
      </Scene>
    ) as Scene;
    run(scene);
    const aim = scene.children[0]!.getComponent(Aim)!;
    expect(aim.seen).toBe(target.current);
  });

  it('instantiates a prefab by calling it: a fresh tree each time, awake before it returns', () => {
    const Prefab = prefab(() => (
      <Group>
        <Aim />
      </Group>
    ));
    const scene = new Scene();
    run(scene);
    const a = instantiate(Prefab, { position: [1, 0, 0] });
    const b = instantiate(Prefab);
    expect(a).not.toBe(b);
    expect(a.parent).toBe(scene);
    expect(a.position.x).toBe(1);
    expect(a.getComponent(Aim)).not.toBe(b.getComponent(Aim));
  });

  it('places and names a prefab tag’s root as a Unity instance; a plain function is a component, all props', () => {
    const seen: object[] = [];
    const Tower = prefab((props: { level: number }) => (seen.push(props), <Group name="tower" />));
    const tower = (<Tower level={2} position={[1, 0, 2]} name="north tower" />) as unknown as Group;
    expect(tower.position.toArray()).toEqual([1, 0, 2]);
    expect(tower.name).toBe('north tower');
    expect(seen).toEqual([{ level: 2 }]);

    const Pair = prefab(() => (
      <>
        <Group />
        <Group />
      </>
    ));
    expect(() => <Pair />).toThrow('returns 2 elements: a prefab is one whole thing — wrap them in one <Group>.');

    const Label = (props: { name: string }) => (seen.push(props), <Group />);
    expect((<Label name="HUD" />) as unknown as Group).toMatchObject({ name: '' });
    expect(seen.at(-1)).toEqual({ name: 'HUD' });
    expect(() => instantiate(Label as never)).toThrow('instantiate(Label): Label is a plain function, not a prefab — make it one where it is declared: export const Label = prefab(() => …).');
  });

  it('takes a prefab as a field, as Unity takes a prefab in the inspector', () => {
    const Shot = prefab(() => <Group name="shot" />);
    const scene = (
      <Scene>
        <Group>
          <Launcher shot={Shot} />
        </Group>
      </Scene>
    ) as Scene;
    run(scene);
    const fired = scene.children[0]!.getComponent(Launcher)!.fire();
    expect(fired.name).toBe('shot');
  });

  it('answers a lowercase tag, an unplaceable child and a ref-typed field with what to write', () => {
    expect(() => jsx('mesh', {})).toThrow(/<Mesh>, not <mesh>/);
    expect(() => jsx(Group, { children: new Color() })).toThrow(/needs attach=/);
    const target = ref<Group>();
    // @ts-expect-error a field holds the object a ref points at, never the ref
    const holder = <Holder target={target} />;
    expect(() => jsx(Group, { children: holder })).toThrow(/declare it as target: Mesh \| null = null/);
  });
});

describe('development builds', () => {
  it('remember the attributes each element was written with — a behaviour’s too — for the editor to put back', async () => {
    // From the sources: what the editor reads lives beside jsxDEV, in the same module.
    const { jsxDEV, givenOf } = await import('../../packages/core/src/jsx.js');
    const { Behaviour: SourceBehaviour, behavioursOn } = await import('../../packages/core/src/kernel/index.js');
    class Spin extends SourceBehaviour {
      speed = 1;
    }
    const at = { fileName: 'scene.tsx', lineNumber: 1, columnNumber: 1 };
    const spin = jsxDEV(Spin, { speed: 3 }, undefined, false, at);
    const mesh = jsxDEV(Mesh, { position: [0, 1, 0], castShadow: true, children: spin }, undefined, false, at) as Mesh;
    expect(givenOf(mesh)).toEqual({ position: [0, 1, 0], castShadow: true });
    expect(givenOf(behavioursOn(mesh)[0]!)).toEqual({ speed: 3 });
  });

  it('keep a prefab root’s own element apart from the tag that placed it: the prefab’s own, and the copy’s overrides', async () => {
    const { jsxDEV, givenOf, ownOf, prefab: makePrefab, sourceOf } = await import('../../packages/core/src/jsx.js');
    const inside = { fileName: 'prefabs.tsx', lineNumber: 2, columnNumber: 3 };
    const tagAt = { fileName: 'scene.tsx', lineNumber: 9, columnNumber: 5 };
    const Coin = makePrefab(() => jsxDEV(Group, { name: 'coin', visible: false }, undefined, false, inside));
    const copy = jsxDEV(Coin, { position: [2, 0, 0] }, undefined, false, tagAt) as Group;
    expect(sourceOf(copy)).toBe(tagAt);
    expect(givenOf(copy)).toEqual({ position: [2, 0, 0] });
    expect(ownOf(copy)).toEqual({ source: inside, given: { name: 'coin', visible: false } });
  });
});
