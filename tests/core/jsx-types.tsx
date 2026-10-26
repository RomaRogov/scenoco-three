import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera } from 'three';
import { Behaviour, ref } from '@scenoco-three/core';
import { Bob, Spawner } from '../fixtures';

/** Typecheck-only: every line marked @ts-expect-error must stay an error. */
export const Probe = () => {
  const cam = ref<PerspectiveCamera>();
  const group = ref<Group>();
  return (
    <Group>
      {/* @ts-expect-error lowercase: no intrinsic elements */}
      <mesh />
      {/* @ts-expect-error misspelled property */}
      <Mesh castShadoww />
      {/* @ts-expect-error wrong value type */}
      <Mesh castShadow="yes" />
      {/* @ts-expect-error vector with two numbers */}
      <Mesh position={[0, 1]} />
      {/* @ts-expect-error a ref of the wrong class */}
      <Mesh ref={cam} />
      {/* @ts-expect-error constructor args of the wrong type */}
      <BoxGeometry args={['wide']} />
      {/* @ts-expect-error a behaviour's unknown field */}
      <Bob heigth={1} />
      {/* @ts-expect-error a behaviour field of the wrong type */}
      <Spawner interval="fast" />
      <Mesh position={[0, 1, 2]} scale={2} rotation={[0, Math.PI, 0]} castShadow>
        <BoxGeometry args={[1, 2, 3]} />
        <MeshStandardMaterial color="#f80" />
      </Mesh>
      <Color attach="background" args={[1, 0.5, 0]} />
      <Spawner cloud={group} interval={0.5} />
      <Mesh ref={ref<Mesh>()} />
    </Group>
  );
};

class Swarm extends Behaviour<Group> {
  marching = true;
}

/** Typecheck-only: a behaviour that drives a Group goes on a node typed as one. */
export function addsToTypedNodes() {
  const swarm: Swarm = new Group().addComponent(Swarm, { marching: false });
  // @ts-expect-error a node typed Object3D cannot carry a Behaviour<Group>
  new Object3D().addComponent(Swarm);
  return swarm;
}
