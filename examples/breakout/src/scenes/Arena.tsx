import { Group, Mesh, PointLight } from 'three';
import { ref } from '@scenoco-three/core';
import { BoxCollider2D, Rigidbody2D, RigidbodyType2D } from '@scenoco-three/box2d';
import { geometry, paint } from '../assets';
import { BallLights } from '../BallLights';
import { Floor } from '../Floor';
import { Paddle } from '../Paddle';
import { BallPrefab, BoltPrefab, bouncy } from './prefabs';

/**
 * The furniture every level shares: the backdrop, the walls with their neon tubes, the paddle, the
 * ball, and the sensor across the floor. Only the bricks change from level to level. Walls and the
 * floor are colliders with no body: static.
 */
export const Arena = () => {
  const body = ref<Mesh>();
  const cannons = ref<Group>();
  return (
    <Group>
      {/* Brushed metal under a glowing grid: the ball's light runs across it as it flies. */}
      <Mesh name="backdrop" position={[0, 7, -1.1]} geometry={geometry.backdrop} material={paint.backdrop} />

      <Mesh name="wallLeft" position={[-9.5, 7.75, 0]} geometry={geometry.wallSide} material={paint.wall}>
        <BoxCollider2D size={[0.5, 16.5]} material={bouncy} />
        <Mesh position={[0.29, 0, 0.3]} geometry={geometry.tubeSide} material={paint.tube} />
      </Mesh>
      <Mesh name="wallRight" position={[9.5, 7.75, 0]} geometry={geometry.wallSide} material={paint.wall}>
        <BoxCollider2D size={[0.5, 16.5]} material={bouncy} />
        <Mesh position={[-0.29, 0, 0.3]} geometry={geometry.tubeSide} material={paint.tube} />
      </Mesh>
      <Mesh name="wallTop" position={[0, 15.75, 0]} geometry={geometry.wallTop} material={paint.wall}>
        <BoxCollider2D size={[19.5, 0.5]} material={bouncy} />
        <Mesh position={[0, -0.29, 0.3]} geometry={geometry.tubeTop} material={paint.tube} />
      </Mesh>

      {/* Kinematic: the paddle moves its node and the body follows, so it shoves the ball rather
          than being shoved. Its width is the node's scale; what is seen is `body`, which it animates. */}
      <Group name="paddle" position={[0, 1, 0]}>
        <Paddle body={body} cannons={cannons} bolt={BoltPrefab} />
        <Rigidbody2D bodyType={RigidbodyType2D.Kinematic} />
        <BoxCollider2D size={[3.2, 0.48]} material={bouncy} />
        <Mesh ref={body} geometry={geometry.paddle} material={paint.paddle}>
          <PointLight color="#2ff5d2" intensity={3} distance={6} decay={2} position={[0, 0.6, 1]} />
        </Mesh>
        <Group ref={cannons} name="cannons" visible={false}>
          <Mesh position={[-1.35, 0.32, 0]} geometry={geometry.cannon} material={paint.cannon} />
          <Mesh position={[1.35, 0.32, 0]} geometry={geometry.cannon} material={paint.cannon} />
        </Group>
      </Group>

      <BallPrefab position={[0, 1.62, 0]} />
      {/* The balls' glow: a fixed set of lights following the first three balls (see BallLights). */}
      <Group name="ballLights">
        <BallLights />
        <PointLight color="#ffb347" intensity={7} distance={7} decay={2} />
        <PointLight color="#ffb347" intensity={7} distance={7} decay={2} />
        <PointLight color="#ffb347" intensity={7} distance={7} decay={2} />
      </Group>

      {/* A trigger, not a wall: it reports the overlap and lets the ball fall through. */}
      <Group name="floor" position={[0, -0.6, 0]}>
        <BoxCollider2D size={[19.5, 0.5]} isTrigger />
        <Floor />
      </Group>
    </Group>
  );
};
