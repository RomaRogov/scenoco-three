import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Mesh } from 'three';
import {
  BOUNDS,
  CRATES,
  DEPOT_RADIUS,
  PICKUP_RADIUS,
  SPEED,
  STACK_LIFT,
  STACK_SPACING,
  type Yard as YardState,
} from './store.js';

/**
 * The scene, as a component tree.
 *
 * The simulation is one `useFrame` rather than one per behaviour. `useFrame` callbacks run in
 * mount order unless given a priority, and the order of these five steps is the specification —
 * so making it depend on where a component happens to sit in the tree would be a bug waiting for
 * someone to reorder a JSX block.
 */
export function Yard({ state }: { state: YardState }): React.JSX.Element {
  const player = useRef<Mesh>(null);
  const crates = useRef<Array<Mesh | null>>([]);
  // Which crates are still in the world. A delivered crate is *unmounted*, not hidden: leaving
  // an invisible mesh stacked in mid-air would be a lie the scene graph then tells everyone who
  // reads it. This changes on a game event, not per frame, so a re-render is the right cost.
  const [present, setPresent] = useState<number[]>(() => CRATES.map((_, index) => index));

  useLayoutEffect(() => {
    state.player = player.current;
    const carried = new Set(state.stack);
    state.loose = present
      .map((index) => crates.current[index])
      .filter((crate): crate is Mesh => crate != null && !carried.has(crate));
  }, [state, present]);

  useFrame((_, delta) => {
    // The clock first, so a crate touched on the frame it reaches zero is not collected.
    state.timeLeft = Math.max(0, state.timeLeft - delta);
    const capsule = state.player;
    if (!capsule) return;

    if (state.timeLeft > 0) {
      // Clamped rather than normalised: a half-pushed stick moves at half speed.
      const length = state.move.length();
      const scale = length > 1 ? 1 / length : 1;
      capsule.position.x += state.move.x * scale * SPEED * delta;
      capsule.position.z += -state.move.y * scale * SPEED * delta;
      capsule.position.x = clamp(capsule.position.x, -BOUNDS, BOUNDS);
      capsule.position.z = clamp(capsule.position.z, -BOUNDS, BOUNDS);

      for (let i = state.loose.length - 1; i >= 0; i--) {
        const crate = state.loose[i]!;
        const reach = Math.hypot(
          crate.position.x - capsule.position.x,
          crate.position.z - capsule.position.z,
        );
        if (reach >= PICKUP_RADIUS) continue;
        state.loose.splice(i, 1);
        state.stack.push(crate);
      }

      if (
        state.stack.length > 0 &&
        Math.hypot(capsule.position.x, capsule.position.z) < DEPOT_RADIUS
      ) {
        state.score += state.stack.length;
        const banked = new Set(state.stack.map((crate) => crate.userData['index'] as number));
        state.stack.length = 0;
        setPresent((remaining) => remaining.filter((index) => !banked.has(index)));
      }
    }

    // The stack last, so the crates are where the player ended up, not where it started.
    for (const [index, crate] of state.stack.entries()) {
      crate.position.set(
        capsule.position.x,
        capsule.position.y + 0.8 + STACK_LIFT + index * STACK_SPACING,
        capsule.position.z,
      );
    }
  });

  return (
    <>
      <color attach="background" args={['#0d1117']} />
      <ambientLight color="#9fb4d0" intensity={0.9} />
      <directionalLight color="#fff6e8" intensity={2.1} position={[6, 16, 8]} />

      <mesh name="ground" rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#2b3242" roughness={0.95} />
      </mesh>

      {/* Centred half a thickness outside the floor's edge, so the inner face is flush with it. */}
      {WALLS.map(([x, z, turn], index) => (
        <mesh key={index} name="wall" position={[x, 0.5, z]} rotation={[0, turn, 0]}>
          <boxGeometry args={[20, 1, 0.5]} />
          <meshStandardMaterial color="#3a4358" roughness={0.8} />
        </mesh>
      ))}

      <mesh name="depot" position={[0, 0.05, 0]}>
        <cylinderGeometry args={[2, 2, 0.1, 48]} />
        <meshStandardMaterial color="#22c55e" roughness={0.5} />
      </mesh>

      <mesh ref={player} name="player" position={[0, 0.8, 6]}>
        <capsuleGeometry args={[0.4, 0.8, 8, 16]} />
        <meshStandardMaterial color="#3b82f6" roughness={0.4} metalness={0.1} />
      </mesh>

      {present.map((index) => (
        <mesh
          key={index}
          name="crate"
          userData={{ index }}
          position={[CRATES[index]![0], 0.3, CRATES[index]![1]]}
          ref={(mesh) => {
            crates.current[index] = mesh;
          }}
        >
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <meshStandardMaterial color="#d99a2b" roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

const WALLS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -10.25, 0],
  [0, 10.25, 0],
  [-10.25, 0, Math.PI / 2],
  [10.25, 0, Math.PI / 2],
];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
