import { Group, Mesh, PlaneGeometry } from 'three';
import { prefab } from '@scenoco-three/core';
import { BoxCollider, MeshCollider, Rigidbody, SphereCollider } from '@scenoco-three/rapier';
import { materials, models } from '../assets';
import { unity } from '../layout';
import { Stone } from '../markers';
import { ModelView } from '../ModelView';
import { StarController } from '../StarController';

// The Unity prefabs. A stone's model sits as high as Unity's prefab lifted it; its collider is
// the mesh itself, as Unity's non-convex MeshCollider was.

export const Stone1 = prefab(() => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.49, 0]}>
      <ModelView model={models.stone1} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
));

export const Stone2 = prefab(() => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.7, 0]}>
      <ModelView model={models.stone2} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
));

export const Stone3 = prefab(() => (
  <Group name="stone">
    <Stone />
    <Group position={[0, 0.04, 0]}>
      <ModelView model={models.stone3} material={materials.stone} />
      <MeshCollider />
    </Group>
  </Group>
));

/** A star: a sprite 2.58 m by 2.26 m (star.png at 600 pixels a metre), caught by a 0.7 m trigger. */
export const Star = prefab(() => (
  <Group name="star" quaternion={unity.starRotation}>
    <Mesh material={materials.star}>
      <PlaneGeometry args={[2.583, 2.257]} />
      <SphereCollider radius={0.7} isTrigger />
      <StarController />
    </Mesh>
  </Group>
));

// What a broken egg leaves: the two halves of the shell, falling, and the fried egg. The shell
// falls through the egg spreading under it (main.ts has the two layers ignore each other).
export const layers = { shell: 1, fried: 2 };

export const EggTop = prefab(() => (
  <Group name="shell top">
    <Rigidbody />
    <MeshCollider convex density={2.15} layer={layers.shell} />
    <ModelView model={models.eggTop} material={materials.egg} />
  </Group>
));

export const EggBottom = prefab(() => (
  <Group name="shell bottom">
    <Rigidbody />
    <MeshCollider convex density={2.15} layer={layers.shell} />
    <ModelView model={models.eggBottom} material={materials.egg} />
  </Group>
));

export const Fried = prefab(() => (
  <Group name="fried egg">
    <Rigidbody />
    {/* Narrower than the white, so it spreads into the valley's curve without wedging, and tall, so
        the ground it rests on never reaches its middle — a thin box pressed in there was pushed down
        through the slope. Its bottom is the model's. */}
    <BoxCollider size={[2.4, 1.5, 2.3]} center={[0.1, 0.68, 0.02]} layer={layers.fried} />
    <ModelView model={models.fried} materials={{ white: materials.friedWhite, yolk: materials.friedYolk }} castShadow={false} receiveShadow />
  </Group>
));
