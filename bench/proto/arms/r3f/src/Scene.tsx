import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

/**
 * The whole prototype, in one component.
 *
 * Sizes follow three.js's own defaults, which are not Unity's — `<boxGeometry args={[1, 1, 1]} />`
 * is one unit on a side, `<cylinderGeometry args={[0.5, 0.5, 2]} />` is one across and two tall,
 * and a node's position is the *middle* of it, so a 1-tall cube resting on the ground sits at
 * y = 0.5.
 */
export function Sketch(): React.ReactElement {
  const block = useRef<Mesh>(null);

  // Degrees per second the block turns.
  const spin = 45;

  useFrame((_state, dt) => {
    if (block.current) block.current.rotation.y += ((spin * Math.PI) / 180) * dt;
  });

  return (
    <>
      <ambientLight color="#9db8d8" intensity={0.7} />
      <directionalLight color="#fff4e0" intensity={2} position={[4, 8, 5]} />

      {/* The ground: a 10 x 10 plane, laid flat and scaled to 40 across. */}
      <mesh name="ground" rotation={[-Math.PI / 2, 0, 0]} scale={4}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#2a3b4d" roughness={0.9} />
      </mesh>

      {/* A 1 x 1 x 1 cube, resting on the ground, turning. */}
      <mesh name="block" ref={block} position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#e9c46a" roughness={0.5} metalness={0.1} />
      </mesh>
    </>
  );
}
