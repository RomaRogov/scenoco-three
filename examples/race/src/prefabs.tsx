import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { prefab } from '@scenoco-three/core';
import { BoxCollider, Rigidbody, RigidbodyConstraints } from '@scenoco-three/rapier';
import { ArcadeCar } from './ArcadeCar';
import { models } from './assets';
import { CarModel } from './CarModel';
import { CarDriver } from './CarDriver';
import { TrackPosition } from './TrackPosition';

/**
 * A racing car, its nose at +Z. Rapier moves it and resolves the bumps; `ArcadeCar` decides how it
 * drives, from what `CarDriver` asks — the player's keys when `human`, the spline otherwise, keeping
 * to `lane` at `pace`. Each copy sets its own on its tag: colour, who drives, lane and pace.
 */
export const Car = prefab(
  ({ color = '#e2412f', human = false, lane = 0, pace = 0.9 }: { color?: string; human?: boolean; lane?: number; pace?: number }) => (
    <Group>
      <Rigidbody useGravity={false} constraints={RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ} />
      <BoxCollider size={[2, 0.9, 4.4]} center={[0, 0.65, 0]} friction={0.1} />
      <TrackPosition />
      <ArcadeCar />
      <CarModel model={models.car} color={color} />
      <CarDriver human={human} lane={lane} pace={pace} />
    </Group>
  ),
);

/** A camera drone circling over the track: the spline drives it with `SplineAnimate`, high above. */
export const Drone = prefab(() => (
  <Group>
    <Mesh position={[0, 14, 0]} castShadow>
      <BoxGeometry args={[1.2, 0.3, 1.2]} />
      <MeshStandardMaterial color="#2b2f36" metalness={0.6} roughness={0.35} />
    </Mesh>
    <Mesh position={[0, 13.8, 0.65]}>
      <SphereGeometry args={[0.18, 10, 8]} />
      <MeshStandardMaterial color="#ff3030" emissive="#ff3030" emissiveIntensity={2} />
    </Mesh>
  </Group>
));

/** A lamp post. */
export const Lamp = prefab(() => (
  <Group>
    <Mesh position={[0, 2.5, 0]} castShadow>
      <CylinderGeometry args={[0.08, 0.12, 5, 8]} />
      <MeshStandardMaterial color="#5b6670" metalness={0.6} roughness={0.4} />
    </Mesh>
    <Mesh position={[0, 5.1, 0]}>
      <SphereGeometry args={[0.3, 12, 8]} />
      <MeshStandardMaterial color="#fff6d6" emissive="#ffe8a3" emissiveIntensity={1.5} />
    </Mesh>
  </Group>
));
