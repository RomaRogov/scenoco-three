import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { Runtime, wake } from '@scenoco-three/core';
import { Behaviour, instantiate, ref } from '@scenoco-three/core';
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

describe('TSX on three.js', () => {
  it('builds what it says: args, R3F-style values, dashed paths, attach', () => {
    const light = ref<DirectionalLight>();
    const scene = (
      <Scene>
        <Color attach="background" args={['#0b1020']} />
        <Fog attach="fog" args={['#000000', 1, 9]} />
        <DirectionalLight ref={light} position={[1, 2, 3]} castShadow shadow-mapSize={[512, 256]} />
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
    const Prefab = () => (
      <Group>
        <Aim />
      </Group>
    );
    const scene = new Scene();
    run(scene);
    const a = instantiate(Prefab, { position: [1, 0, 0] });
    const b = instantiate(Prefab);
    expect(a).not.toBe(b);
    expect(a.parent).toBe(scene);
    expect(a.position.x).toBe(1);
    expect(a.getComponent(Aim)).not.toBe(b.getComponent(Aim));
  });

  it('answers a lowercase tag and an unplaceable child with what to write', () => {
    expect(() => jsx('mesh', {})).toThrow(/<Mesh>, not <mesh>/);
    expect(() => jsx(Group, { children: new Color() })).toThrow(/needs attach=/);
  });
});
