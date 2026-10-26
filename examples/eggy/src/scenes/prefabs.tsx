import { Group, Mesh, PlaneGeometry } from 'three';
import { MeshCollider, Rigidbody, SphereCollider } from '@scenoco-three/rapier';
import { materials, models } from '../assets';
import { unity } from '../layout';
import { Stone } from '../markers';
import { ModelView } from '../ModelView';
import { StarController } from '../StarController';

// The Unity prefabs. A stone's model sits as high as Unity's prefab lifted it; its collider is
// the mesh itself, as Unity's non-convex MeshCollider was.

export const Stone1 = () => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.49, 0]}>
      <ModelView model={models.stone1} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
);

export const Stone2 = () => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.7, 0]}>
      <ModelView model={models.stone2} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
);

export const Stone3 = () => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.04, 0]}>
      <ModelView model={models.stone3} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
);

/** A star: a sprite 2.58 m by 2.26 m (star.png at 600 pixels a metre), caught by a 0.7 m trigger. */
export const Star = () => (
  <Group name="star" quaternion={unity.starRotation}>
    <Mesh material={materials.star}>
      <PlaneGeometry args={[2.583, 2.257]} />
      <SphereCollider radius={0.7} isTrigger />
      <StarController />
    </Mesh>
  </Group>
);

// What a broken egg leaves: the two halves of the shell, falling, and the fried egg.

export const EggTop = () => (
  <Group name="shell top">
    <Rigidbody />
    <MeshCollider convex density={2.15} />
    <ModelView model={models.eggTop} material={materials.egg} />
  </Group>
);

export const EggBottom = () => (
  <Group name="shell bottom">
    <Rigidbody />
    <MeshCollider convex density={2.15} />
    <ModelView model={models.eggBottom} material={materials.egg} />
  </Group>
);

export const Fried = () => (
  <Group name="fried egg">
    <ModelView model={models.fried} materials={{ white: materials.friedWhite, yolk: materials.friedYolk }} castShadow={false} receiveShadow />
  </Group>
);
