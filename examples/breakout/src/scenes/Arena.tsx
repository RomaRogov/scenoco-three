import { AmbientLight, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PointLight } from 'three';
import { prefab } from '@scenoco-three/core';
import { BoxCollider2D } from '@scenoco-three/box2d';
import { BallLights } from '../BallLights';
import { CameraRig } from '../CameraRig';
import { Floor } from '../Floor';
import { GameState } from '../GameState';
import { NeonGridTexture } from '../textures';
import { BallPrefab, PaddlePrefab, WallPrefab } from './prefabs';

/**
 * Everything a level has besides its bricks: the level's rules (`GameState`), the lights, the camera,
 * the backdrop, the walls, the paddle, the ball, and the sensor across the floor. A prefab — every
 * level places one, so it is edited once, in prefab mode; a level only names itself and its pace.
 */
export const Arena = prefab(({ title = '', ballSpeed = 14 }: { title?: string; ballSpeed?: number }) => (
  <Group>
    <GameState levelName={title} ballSpeed={ballSpeed} />

    {/* Little fill, so the neon carries the picture: a cool sky, a warm key from over the camera,
        and a magenta rim from the far side that edges every brick. */}
    <AmbientLight color="#6d8cff" intensity={0.25} />
    <HemisphereLight args={['#5b7cff', '#120a1f', 0.6]} />
    <DirectionalLight color="#ffe8d1" intensity={1.6} position={[4, -6, 14]} />
    <DirectionalLight color="#ff4fd8" intensity={1.4} position={[-6, 18, -6]} />

    {/* Behind the paddle, looking up the field: the near paddle and far wall in perspective. */}
    <PerspectiveCamera near={0.1} far={200} position={[0, -2, 19]}>
      <CameraRig target={[0, 6.994, 0]} />
    </PerspectiveCamera>

    {/* Brushed metal under a glowing grid: the ball's light runs across it as it flies. */}
    <Mesh name="backdrop" position={[0, 7, -1.1]}>
      <PlaneGeometry args={[64, 44]} />
      <MeshStandardMaterial color="#0a1124" emissive="#2f6bff" emissiveIntensity={0.5} roughness={0.42} metalness={0.55}>
        <NeonGridTexture attach="emissiveMap" repeat={[16, 11]} />
      </MeshStandardMaterial>
    </Mesh>

    <WallPrefab name="wallLeft" position={[-9.5, 7.75, 0]} />
    <WallPrefab name="wallRight" position={[9.5, 7.75, 0]} tubeAt={[-0.29, 0, 0.3]} outsideX={1} />
    <WallPrefab name="wallTop" position={[0, 15.75, 0]} width={19.5} height={0.5} tubeWidth={18.5} tubeHeight={0.146} tubeAt={[0, -0.29, 0.3]} outsideX={0} outsideY={1} />

    <PaddlePrefab name="paddle" position={[0, 1, 0]} />
    <BallPrefab position={[0, 1.62, 0]} />
    {/* The balls' glow: a fixed set of lights following the first three balls. */}
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
));
