import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, SphereGeometry, CylinderGeometry } from 'three';
import { prefab, sharedModel } from '@scenoco-three/core';
import { BoxCollider, Rigidbody, SphereCollider, type PhysicsMaterial } from '@scenoco-three/rapier';
import { Coin } from '../Coin';
import { rubber } from '../materials';
import robotUrl from '../models/RobotExpressive.glb?url';

/**
 * Tomás Laulhé's robot (CC0, from three.js's examples): Idle, Walking, Running, Jump and more as clips.
 * Declared here, so `play` loads it before the first scene; a model is a prefab, as in Unity.
 */
const robot = sharedModel(robotUrl);
export const Robot = prefab(robot);

/** A wooden crate: a body to push, shove and slide. `surface` is the PhysicsMaterial of its faces. */
export const Crate = prefab(({ color = '#b9824a', surface = null }: { color?: string; surface?: PhysicsMaterial | null }) => (
  <Mesh castShadow receiveShadow>
    <BoxGeometry />
    <MeshStandardMaterial color={color} roughness={0.8} />
    <Rigidbody />
    <BoxCollider material={surface} />
  </Mesh>
));

/** A rubber ball: bounces nearly as high as it fell. */
export const Ball = prefab(() => (
  <Mesh castShadow>
    <SphereGeometry args={[0.35, 24, 16]} />
    <MeshStandardMaterial color="#e2412f" roughness={0.4} />
    <Rigidbody />
    <SphereCollider material={rubber} />
  </Mesh>
));

/**
 * A coin over the path: its collider is a trigger, so it is walked through, not into. The root turns —
 * placed by the spline, then spun by `Coin` — and the disc stands upright inside it.
 */
export const CoinPickup = prefab(() => (
  <Group>
    <SphereCollider isTrigger radius={0.5} />
    <Coin />
    <Mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
      <CylinderGeometry args={[0.35, 0.35, 0.08, 24]} />
      <MeshStandardMaterial color="#ffc83d" metalness={0.7} roughness={0.25} emissive="#5a3c00" />
    </Mesh>
  </Group>
));

/** Where a click's ray hit: a ring, turned to the surface by `Shove`. */
export const ShoveMark = prefab(() => (
  <Mesh renderOrder={5}>
    <RingGeometry args={[0.22, 0.32, 32]} />
    <MeshBasicMaterial color="#ffffff" side={DoubleSide} transparent opacity={0.9} depthWrite={false} />
  </Mesh>
));
