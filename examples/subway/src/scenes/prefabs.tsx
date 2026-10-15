import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { Coin } from '../Coin';
import { Obstacle } from '../Obstacle';
import { Scroll } from '../Scroll';
import { trackTexture } from '../textures';

/** Everything that arrives in one wave: obstacles and coins are its children. */
export const Row = () => (
  <Group name="row">
    <Scroll killZ={22} />
  </Group>
);

/** A 20 m stretch of track, platforms and an overhead gantry. */
export const Segment = () => (
  <Group name="segment">
    <Scroll killZ={32} />
    <Mesh position={[0, -0.27, 0]} receiveShadow>
      <BoxGeometry args={[110, 0.4, 20]} />
      <MeshStandardMaterial color="#2b2338" roughness={1} />
    </Mesh>
    <Mesh position={[0, -0.04, 0]} receiveShadow>
      <BoxGeometry args={[8.6, 0.12, 20]} />
      <MeshStandardMaterial map={trackTexture} roughness={1} />
    </Mesh>

    <Mesh position={[-2.8, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>
    <Mesh position={[-2.0, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>
    <Mesh position={[-0.4, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>
    <Mesh position={[0.4, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>
    <Mesh position={[2.0, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>
    <Mesh position={[2.8, 0.09, 0]} castShadow receiveShadow>
      <BoxGeometry args={[0.1, 0.16, 20]} />
      <MeshStandardMaterial color="#c9c6d8" metalness={0.8} roughness={0.35} />
    </Mesh>

    <Mesh position={[-6.4, 0.3, 0]} receiveShadow castShadow>
      <BoxGeometry args={[3.5, 0.7, 20]} />
      <MeshStandardMaterial color="#7a7387" roughness={0.9} />
    </Mesh>
    <Mesh position={[6.4, 0.3, 0]} receiveShadow castShadow>
      <BoxGeometry args={[3.5, 0.7, 20]} />
      <MeshStandardMaterial color="#7a7387" roughness={0.9} />
    </Mesh>
    <Mesh position={[-4.8, 0.66, 0]}>
      <BoxGeometry args={[0.25, 0.04, 20]} />
      <MeshStandardMaterial color="#f2c230" emissive="#f2a000" emissiveIntensity={0.35} />
    </Mesh>
    <Mesh position={[4.8, 0.66, 0]}>
      <BoxGeometry args={[0.25, 0.04, 20]} />
      <MeshStandardMaterial color="#f2c230" emissive="#f2a000" emissiveIntensity={0.35} />
    </Mesh>

    <Mesh position={[-5.4, 3.65, 0]} castShadow>
      <BoxGeometry args={[0.35, 6, 0.35]} />
      <MeshStandardMaterial color="#3a3547" roughness={0.6} metalness={0.4} />
    </Mesh>
    <Mesh position={[5.4, 3.65, 0]} castShadow>
      <BoxGeometry args={[0.35, 6, 0.35]} />
      <MeshStandardMaterial color="#3a3547" roughness={0.6} metalness={0.4} />
    </Mesh>
    <Mesh position={[0, 6.7, 0]} castShadow>
      <BoxGeometry args={[11.2, 0.45, 0.45]} />
      <MeshStandardMaterial color="#3a3547" roughness={0.6} metalness={0.4} />
    </Mesh>
    <Mesh position={[-2.4, 6.4, 0]}>
      <BoxGeometry args={[1.2, 0.12, 0.5]} />
      <MeshBasicMaterial color="#fff0c8" />
    </Mesh>
    <Mesh position={[2.4, 6.4, 0]}>
      <BoxGeometry args={[1.2, 0.12, 0.5]} />
      <MeshBasicMaterial color="#fff0c8" />
    </Mesh>
  </Group>
);

/** Unit box; the spawner scales it into a tower and gives it windows. */
export const Building = () => (
  <Mesh>
    <BoxGeometry />
    <MeshStandardMaterial roughness={0.85} emissive="#ffffff" emissiveIntensity={1.1} />
  </Mesh>
);

/** A parked train, 10 m long, front toward the runner. Crash on contact. */
export const Train = () => (
  <Group>
    <Obstacle kind="train" yMin={0} yMax={3.3} halfX={1.05} halfZ={5} />
    <Mesh name="body" position={[0, 1.7, 0]} castShadow receiveShadow>
      <BoxGeometry args={[2.1, 3.0, 10]} />
      <MeshStandardMaterial color="#e4572e" roughness={0.45} metalness={0.25} />
    </Mesh>
    <Mesh position={[0, 0.17, 0]} castShadow>
      <BoxGeometry args={[1.8, 0.34, 9.6]} />
      <MeshStandardMaterial color="#25222e" roughness={0.8} />
    </Mesh>
    <Mesh position={[0, 3.25, 0]} castShadow>
      <BoxGeometry args={[1.9, 0.14, 9.8]} />
      <MeshStandardMaterial color="#d9d7e4" roughness={0.6} />
    </Mesh>
    <Mesh position={[0, 2.05, 0]}>
      <BoxGeometry args={[2.14, 0.8, 9.2]} />
      <MeshStandardMaterial color="#1c2440" emissive="#3a5aa8" emissiveIntensity={0.55} roughness={0.2} />
    </Mesh>
    <Mesh position={[0, 1.3, 0]}>
      <BoxGeometry args={[2.16, 0.12, 10.02]} />
      <MeshStandardMaterial color="#f5f2ea" roughness={0.5} />
    </Mesh>
    <Mesh position={[0, 2.2, 5.02]}>
      <BoxGeometry args={[1.6, 0.9, 0.06]} />
      <MeshStandardMaterial color="#10142a" emissive="#2a4a98" emissiveIntensity={0.6} roughness={0.2} />
    </Mesh>
    <Mesh position={[-0.65, 0.75, 5.03]}>
      <BoxGeometry args={[0.4, 0.28, 0.06]} />
      <MeshBasicMaterial color="#fff7d6" />
    </Mesh>
    <Mesh position={[0.65, 0.75, 5.03]}>
      <BoxGeometry args={[0.4, 0.28, 0.06]} />
      <MeshBasicMaterial color="#fff7d6" />
    </Mesh>
  </Group>
);

/** Waist-high striped block: jump over it. */
export const LowBarrier = () => (
  <Group>
    <Obstacle kind="low" yMin={0} yMax={0.95} halfX={1.0} halfZ={0.45} />
    <Mesh position={[0, 0.45, 0]} castShadow receiveShadow>
      <BoxGeometry args={[2.0, 0.9, 0.7]} />
      <MeshStandardMaterial color="#f5f5f5" roughness={0.6} />
    </Mesh>
    <Mesh position={[-0.65, 0.45, 0]}>
      <BoxGeometry args={[0.4, 0.92, 0.72]} />
      <MeshStandardMaterial color="#e63946" roughness={0.6} />
    </Mesh>
    <Mesh position={[0.15, 0.45, 0]}>
      <BoxGeometry args={[0.4, 0.92, 0.72]} />
      <MeshStandardMaterial color="#e63946" roughness={0.6} />
    </Mesh>
    <Mesh position={[0, 0.96, 0]}>
      <BoxGeometry args={[2.0, 0.06, 0.7]} />
      <MeshStandardMaterial color="#fcd34d" emissive="#fbbf24" emissiveIntensity={0.8} />
    </Mesh>
  </Group>
);

/** A beam at head height on two posts: roll under it. */
export const HighBarrier = () => (
  <Group>
    <Obstacle kind="high" yMin={1.05} yMax={1.9} halfX={1.0} halfZ={0.35} />
    <Mesh position={[-0.95, 0.95, 0]} castShadow>
      <BoxGeometry args={[0.18, 1.9, 0.3]} />
      <MeshStandardMaterial color="#444155" metalness={0.5} roughness={0.5} />
    </Mesh>
    <Mesh position={[0.95, 0.95, 0]} castShadow>
      <BoxGeometry args={[0.18, 1.9, 0.3]} />
      <MeshStandardMaterial color="#444155" metalness={0.5} roughness={0.5} />
    </Mesh>
    <Mesh position={[0, 1.5, 0]} castShadow>
      <BoxGeometry args={[2.1, 0.8, 0.4]} />
      <MeshStandardMaterial color="#fcd34d" roughness={0.5} />
    </Mesh>
    <Mesh position={[-0.7, 1.5, 0.21]}>
      <BoxGeometry args={[0.35, 0.82, 0.02]} />
      <MeshStandardMaterial color="#1f1d2b" />
    </Mesh>
    <Mesh position={[0, 1.5, 0.21]}>
      <BoxGeometry args={[0.35, 0.82, 0.02]} />
      <MeshStandardMaterial color="#1f1d2b" />
    </Mesh>
    <Mesh position={[0.7, 1.5, 0.21]}>
      <BoxGeometry args={[0.35, 0.82, 0.02]} />
      <MeshStandardMaterial color="#1f1d2b" />
    </Mesh>
  </Group>
);

export const CoinPickup = () => (
  <Group>
    <Coin />
    <Mesh rotation={[Math.PI / 2, 0, 0]}>
      <CylinderGeometry args={[0.38, 0.38, 0.1, 24]} />
      <MeshStandardMaterial color="#ffc533" emissive="#ff9d00" emissiveIntensity={0.7} metalness={0.8} roughness={0.25} />
    </Mesh>
  </Group>
);
