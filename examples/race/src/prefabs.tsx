import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three';

/** A car, its nose at +Z as `SplineAnimate` faces it. */
export const Car = () => (
  <Group>
    <Mesh position={[0, 0.65, 0]} castShadow>
      <BoxGeometry args={[1.9, 0.6, 4.2]} />
      <MeshStandardMaterial color="#e2412f" roughness={0.4} metalness={0.3} />
    </Mesh>
    <Mesh position={[0, 1.2, -0.3]} castShadow>
      <BoxGeometry args={[1.5, 0.5, 2]} />
      <MeshStandardMaterial color="#1b2633" roughness={0.2} />
    </Mesh>
    <Mesh position={[0.95, 0.38, 1.35]} rotation={[0, 0, Math.PI / 2]}>
      <CylinderGeometry args={[0.38, 0.38, 0.3, 14]} />
      <MeshStandardMaterial color="#111" />
    </Mesh>
    <Mesh position={[-0.95, 0.38, 1.35]} rotation={[0, 0, Math.PI / 2]}>
      <CylinderGeometry args={[0.38, 0.38, 0.3, 14]} />
      <MeshStandardMaterial color="#111" />
    </Mesh>
    <Mesh position={[0.95, 0.38, -1.35]} rotation={[0, 0, Math.PI / 2]}>
      <CylinderGeometry args={[0.38, 0.38, 0.3, 14]} />
      <MeshStandardMaterial color="#111" />
    </Mesh>
    <Mesh position={[-0.95, 0.38, -1.35]} rotation={[0, 0, Math.PI / 2]}>
      <CylinderGeometry args={[0.38, 0.38, 0.3, 14]} />
      <MeshStandardMaterial color="#111" />
    </Mesh>
  </Group>
);

/** A lamp post. */
export const Lamp = () => (
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
);

/** A pine. */
export const Tree = () => (
  <Group>
    <Mesh position={[0, 0.8, 0]} castShadow>
      <CylinderGeometry args={[0.18, 0.25, 1.6, 7]} />
      <MeshStandardMaterial color="#6b4a2e" roughness={1} />
    </Mesh>
    <Mesh position={[0, 3, 0]} castShadow>
      <ConeGeometry args={[1.4, 3.6, 8]} />
      <MeshStandardMaterial color="#2f6b3a" roughness={0.9} flatShading />
    </Mesh>
  </Group>
);
