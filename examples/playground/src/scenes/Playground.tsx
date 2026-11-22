import {
  BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry,
} from 'three';
import { Animator, UIDocument, ref } from '@scenoco-three/core';
import {
  BoxCollider, CapsuleCollider, CharacterController, FixedJoint, HingeJoint, Rigidbody, SpringJoint,
} from '@scenoco-three/rapier';
import { SplineContainer, SplineExtrude, SplineInstantiate } from '@scenoco-three/splines';
import { BallDropper } from '../BallDropper';
import { CoinCounter } from '../CoinCounter';
import { DayNight } from '../DayNight';
import { FollowCamera } from '../FollowCamera';
import { ice, rubber } from '../materials';
import { Player } from '../Player';
import { PressurePlate } from '../PressurePlate';
import { Shove } from '../Shove';
import { Ball, CoinPickup, Crate, Robot, ShoveMark } from './prefabs';

/**
 * A physics playground, a station for each thing the games leave out: a character on Unity's
 * CharacterController, a ray from the pointer, shared PhysicsMaterials, hinge, spring and fixed joints,
 * a trigger that messages a light by name, and a spline extruded into a rail with coins along it.
 */
export const Playground = () => {
  const player = ref<Group>();
  const sun = ref<DirectionalLight>();
  const path = ref<Group>();
  const glued = ref<Rigidbody>();
  return (
    <Scene>
      <Color attach="background" args={['#bcd9ee']} />
      <Fog attach="fog" args={['#bcd9ee', 35, 80]} />
      <HemisphereLight args={['#ffffff', '#6b8a5a', 1.2]} />
      {/* Its shadow box fits the ground, near to far: three.js's bias is a share of that depth, so with
          three.js's 500 m default even -0.0004 lifts shadows 20 cm off the ground. */}
      <DirectionalLight
        ref={sun} position={[10, 18, 8]} intensity={2.2} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-22} shadow-camera-right={22}
        shadow-camera-top={22} shadow-camera-bottom={-22} shadow-camera-near={1} shadow-camera-far={50}
        shadow-bias={-0.0001} shadow-normalBias={0.02}
      >
        <DayNight />
      </DirectionalLight>

      <PerspectiveCamera position={[0, 8, 18]} fov={55}>
        <FollowCamera target={player} offset={[0, 7, 10]} />
        <Shove mark={ShoveMark} />
      </PerspectiveCamera>

      <Group name="ui">
        <UIDocument referenceResolution={[1280, 720]} />
        <CoinCounter />
      </Group>

      {/* The ground: one static collider, sized from its box. */}
      <Mesh name="ground" position={[0, -0.25, 0]} receiveShadow>
        <BoxGeometry args={[44, 0.5, 44]} />
        <MeshStandardMaterial color="#9fc28a" />
        <BoxCollider />
      </Mesh>

      {/* The player: a CharacterController — a capsule moved by Player, pushing what it walks into — and the
          robot model inside it, its feet at the capsule's bottom, with an Animator its tag adds to this copy. */}
      <Group ref={player} name="player" position={[0, 1, 9]}>
        <CharacterController />
        <Player />
        <Robot position={[0, -1, 0]} scale={0.45}>
          <Animator />
        </Robot>
      </Group>

      {/* Crates to walk into and click at. */}
      <Crate position={[-2, 0.5, 4]} />
      <Crate position={[2.5, 0.5, 3]} color="#9a6a3c" />
      <Crate position={[2.5, 1.5, 3]} />

      {/* Ice: a tilted slab and crates of the same PhysicsMaterial, which slide off it. */}
      <Mesh name="ice ramp" position={[-10, 1.2, 0]} rotation={[0, 0, -0.32]} receiveShadow>
        <BoxGeometry args={[7, 0.3, 4]} />
        <MeshStandardMaterial color="#d8f1ff" roughness={0.05} />
        <BoxCollider material={ice} />
      </Mesh>
      <Crate position={[-11.5, 2.4, -0.8]} color="#9fd8ff" surface={ice} />
      <Crate position={[-12.6, 2.9, 0.8]} color="#9fd8ff" surface={ice} />

      {/* Rubber: a pad of the bouncy PhysicsMaterial, and balls dropping onto it. */}
      <Mesh name="rubber pad" position={[10, 0.1, 0]} receiveShadow>
        <BoxGeometry args={[5, 0.2, 5]} />
        <MeshStandardMaterial color="#e86a92" />
        <BoxCollider material={rubber} />
      </Mesh>
      <Group name="ball dropper" position={[10, 7, 0]}>
        <BallDropper ball={Ball} />
      </Group>

      {/* A door on a HingeJoint to the world, swinging both ways up to 110°: walk through it. */}
      <Mesh name="door frame" position={[-1.75, 1.2, -6]} castShadow>
        <BoxGeometry args={[0.3, 2.4, 0.3]} />
        <MeshStandardMaterial color="#5b6472" />
        <BoxCollider />
      </Mesh>
      <Mesh name="door" position={[-0.8, 1.15, -6]} castShadow>
        <BoxGeometry args={[1.6, 2.2, 0.12]} />
        <MeshStandardMaterial color="#c9a26b" />
        <Rigidbody mass={6} angularDamping={1.5} />
        <BoxCollider />
        <HingeJoint axis={[0, 1, 0]} anchor={[-0.8, 0, 0]} useLimits limits={{ min: -110, max: 110 }} />
      </Mesh>

      {/* A windmill: two blades as one body, on a motored HingeJoint — it turns, and knocks things off. */}
      <Mesh name="windmill post" position={[6, 1.6, -9]} castShadow>
        <CylinderGeometry args={[0.2, 0.3, 3.2]} />
        <MeshStandardMaterial color="#5b6472" />
        <BoxCollider />
      </Mesh>
      <Group name="windmill" position={[6, 3, -8.4]}>
        <Rigidbody useGravity={false} />
        <HingeJoint axis={[0, 0, 1]} useMotor motor={{ targetVelocity: 70, force: 400 }} />
        <Mesh castShadow>
          <BoxGeometry args={[4.4, 0.35, 0.15]} />
          <MeshStandardMaterial color="#f2f2f2" />
          <BoxCollider />
        </Mesh>
        <Mesh castShadow rotation={[0, 0, Math.PI / 2]}>
          <BoxGeometry args={[4.4, 0.35, 0.15]} />
          <MeshStandardMaterial color="#f2f2f2" />
          <BoxCollider />
        </Mesh>
      </Group>

      {/* A punching bag on a SpringJoint to the point above it: shove it, and it swings back. */}
      <Mesh name="beam" position={[-6, 3.4, -9]} castShadow>
        <BoxGeometry args={[2, 0.2, 0.2]} />
        <MeshStandardMaterial color="#5b6472" />
      </Mesh>
      <Mesh name="punching bag" position={[-6, 1.7, -9]} castShadow>
        <CapsuleGeometry args={[0.4, 1]} />
        <MeshStandardMaterial color="#7a3b2e" />
        <Rigidbody mass={4} linearDamping={0.6} />
        <CapsuleCollider />
        <SpringJoint anchor={[0, 1.6, 0]} spring={250} damper={3} />
      </Mesh>

      {/* Two crates on a FixedJoint: they move as one, whichever is pushed. */}
      <Mesh name="glued crate" position={[-4, 0.5, 2]} castShadow>
        <BoxGeometry />
        <MeshStandardMaterial color="#6f8fd8" />
        <Rigidbody ref={glued} />
        <BoxCollider />
      </Mesh>
      <Mesh name="glued crate 2" position={[-4, 1.5, 2]} castShadow>
        <BoxGeometry args={[0.7, 1, 0.7]} />
        <MeshStandardMaterial color="#8fa8e8" />
        <Rigidbody />
        <BoxCollider />
        <FixedJoint connectedBody={glued} />
      </Mesh>

      {/* A pressure plate: a trigger that sends `toggle` to the sun by name — day, or night. */}
      <Mesh name="pressure plate" position={[0, 0.05, -12]} receiveShadow>
        <BoxGeometry args={[2, 0.1, 2]} />
        <MeshStandardMaterial color="#8a8f99" />
        <BoxCollider isTrigger size={[2, 0.8, 2]} />
        <PressurePlate target={sun} />
      </Mesh>
      <Mesh name="lamp" position={[0, 0.3, -13.6]}>
        <SphereGeometry args={[0.25, 16, 12]} />
        <MeshStandardMaterial color="#ffd34d" emissive="#ffb300" emissiveIntensity={1.5} />
      </Mesh>

      {/* A rail laid along a spline — SplineExtrude — and coins over it, SplineInstantiate's. */}
      <Group ref={path} name="path">
        <SplineContainer knots={[[-14, 0.15, 7], [-7, 0.15, 5], [-1, 0.15, 7.5], [5, 0.15, 5], [9, 0.15, 7], [14, 0.15, 5]]} />
      </Group>
      <Mesh name="rail" castShadow receiveShadow>
        <SplineExtrude container={path} radius={0.12} sides={10} />
        <MeshStandardMaterial color="#d9a13b" metalness={0.6} roughness={0.35} />
      </Mesh>
      <Group name="coins">
        <SplineInstantiate container={path} itemsToInstantiate={[CoinPickup]} spacing={2.6} positionOffset={[0, 0.9, 0]} alignTo="world" />
      </Group>
    </Scene>
  );
};
