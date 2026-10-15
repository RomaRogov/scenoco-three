import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PointLight, SphereGeometry } from 'three';
import { ref } from '@scenoco-three/core';
import { BoxCollider2D, CircleCollider2D, Rigidbody2D } from '@scenoco-three/box2d';
import { geometry, paint } from '../assets';
import { Ball } from '../Ball';
import { Brick } from '../Brick';
import { Paddle } from '../Paddle';

/**
 * The furniture every level shares: the walls that bounce, the paddle, the ball, and the sensor
 * across the floor. Only the bricks change from level to level — and the ball's pace, which a
 * level passes in.
 *
 * Restitution 1 and no friction everywhere: a Breakout ball leaves a wall as fast as it arrived
 * and at the mirror angle, which is what makes a rally readable.
 */
export const Arena = ({ ballSpeed = 15 }: { ballSpeed?: number }) => {
  const paddle = ref<Mesh>();
  return (
    <Group>
      <Mesh name="wallLeft" position={[-9.5, 7.5, 0]} geometry={geometry.wallSide} material={paint.wall}>
        <Rigidbody2D bodyType="static" />
        <BoxCollider2D halfExtents={[0.25, 8]} restitution={1} friction={0} />
      </Mesh>
      <Mesh name="wallRight" position={[9.5, 7.5, 0]} geometry={geometry.wallSide} material={paint.wall}>
        <Rigidbody2D bodyType="static" fixedRotation={false} />
        <BoxCollider2D halfExtents={[0.25, 8]} restitution={1} friction={0} />
      </Mesh>
      <Mesh name="wallTop" position={[0, 15.75, 0]} material={paint.wall}>
        <BoxGeometry args={[19.5, 0.5, 0.9]} />
        <Rigidbody2D bodyType="static" />
        <BoxCollider2D halfExtents={[9.75, 0.25]} restitution={1} friction={0} />
      </Mesh>

      {/* Kinematic: the paddle moves its node and the body follows, so it shoves the ball rather
          than being shoved. It glows on its own: emissive teal at 1.3 clears the bloom threshold. */}
      <Mesh ref={paddle} name="paddle" position={[0, 1, 0]}>
        <BoxGeometry args={[3.2, 0.45, 0.7]} />
        <MeshStandardMaterial color="#5eead4" emissive="#2dd4bf" emissiveIntensity={1.3} roughness={0.2} metalness={0.5} />
        <PointLight color="#fbbf24" intensity={4} distance={11} decay={2} position={[0, 0.9, 1.2]} />
        <Paddle speed={16} halfRange={7.4} />
        <Rigidbody2D bodyType="kinematic" />
        <BoxCollider2D halfExtents={[1.6, 0.225]} restitution={1} friction={0} />
      </Mesh>

      {/* `bullet`, so a fast ball cannot tunnel through a brick between two steps. */}
      <Mesh name="ball" position={[0, 5.6434, 0]}>
        <SphereGeometry args={[0.32, 28, 20]} />
        <MeshStandardMaterial color="#fef3c7" emissive="#f59e0b" emissiveIntensity={1.4} roughness={0.15} metalness={0.2} />
        <Ball paddle={paddle} steer={62} speed={ballSpeed} />
        <Rigidbody2D bodyType="dynamic" bullet gravityScale={0} linearDamping={0} />
        <CircleCollider2D radius={0.32} restitution={1} friction={0} density={1} />
      </Mesh>

      {/* A sensor, not a wall: it reports the overlap and lets the ball fall through. */}
      <Group name="floor" position={[0, -0.6, 0]}>
        <Rigidbody2D bodyType="static" />
        <BoxCollider2D halfExtents={[9.75, 0.25]} isSensor />
      </Group>
    </Group>
  );
};

/**
 * One brick, all three tiers. `BrickField` spawns it and sets `Brick.hits`; the brick picks the
 * tier's shared material itself.
 */
export const BrickPrefab = () => (
  <Mesh geometry={geometry.brick} material={paint.brickSoft}>
    <Brick soft={paint.brickSoft} firm={paint.brickFirm} hard={paint.brickHard} />
    <Rigidbody2D bodyType="static" />
    <BoxCollider2D halfExtents={[1.2, 0.4]} restitution={1} friction={0} />
  </Mesh>
);
