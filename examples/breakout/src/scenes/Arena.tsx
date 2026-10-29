import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ref } from '@scenoco-three/core';
import { BoxCollider2D, Rigidbody2D, RigidbodyType2D } from '@scenoco-three/box2d';
import { BallLights } from '../BallLights';
import { Floor } from '../Floor';
import { Paddle } from '../Paddle';
import { NeonFrameTexture, NeonGridTexture } from '../textures';
import { BallPrefab, BoltPrefab, bouncy, WallPrefab } from './prefabs';

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
      <Mesh name="backdrop" position={[0, 7, -1.1]}>
        <PlaneGeometry args={[64, 44]} />
        <MeshStandardMaterial color="#0a1124" emissive="#2f6bff" emissiveIntensity={0.5} roughness={0.42} metalness={0.55}>
          <NeonGridTexture attach="emissiveMap" repeat={[16, 11]} />
        </MeshStandardMaterial>
      </Mesh>

      <WallPrefab name="wallLeft" position={[-9.5, 7.75, 0]} />
      <WallPrefab name="wallRight" position={[9.5, 7.75, 0]} tubeAt={[-0.29, 0, 0.3]} />
      <WallPrefab name="wallTop" position={[0, 15.75, 0]} width={19.5} height={0.5} tubeWidth={18.5} tubeHeight={0.07} tubeAt={[0, -0.29, 0.3]} />

      {/* Kinematic: the paddle moves its node and the body follows, so it shoves the ball rather
          than being shoved. Its width is the node's scale; what is seen is `body`, which it animates. */}
      <Group name="paddle" position={[0, 1, 0]}>
        <Paddle body={body} cannons={cannons} bolt={BoltPrefab} fireEvery={0.6} />
        <Rigidbody2D bodyType={RigidbodyType2D.Kinematic} />
        <BoxCollider2D size={[3.2, 0.48]} material={bouncy} />
        <Mesh ref={body}>
          <RoundedBoxGeometry args={[3.2, 0.48, 0.8, 5, 0.22]} />
          <MeshStandardMaterial color="#1a6f78" emissive="#19c9ad" emissiveIntensity={1.2} roughness={0.2} metalness={0.6}>
            <NeonFrameTexture attach="emissiveMap" />
          </MeshStandardMaterial>
          <PointLight color="#2ff5d2" intensity={3} distance={6} decay={2} position={[0, 0.6, 1]} />
        </Mesh>
        <Group ref={cannons} name="cannons" visible={false}>
          <Mesh position={[-1.35, 0.32, 0]}>
            <CapsuleGeometry args={[0.11, 0.42, 4, 10]} />
            <MeshStandardMaterial color="#ff3b6b" emissive="#ff3b6b" emissiveIntensity={2.5} roughness={0.3} metalness={0.2} />
          </Mesh>
          <Mesh position={[1.35, 0.32, 0]}>
            <CapsuleGeometry args={[0.11, 0.42, 4, 10]} />
            <MeshStandardMaterial color="#ff3b6b" emissive="#ff3b6b" emissiveIntensity={2.5} roughness={0.3} metalness={0.2} />
          </Mesh>
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
