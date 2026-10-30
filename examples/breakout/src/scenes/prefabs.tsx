import { BoxGeometry, CapsuleGeometry, Color, Group, Mesh, MeshStandardMaterial, OctahedronGeometry, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { prefab, ref } from '@scenoco-three/core';
import { BoxCollider2D, CircleCollider2D, CollisionDetectionMode2D, PhysicsMaterial2D, Rigidbody2D } from '@scenoco-three/box2d';
import { ParticleSystem } from '@scenoco-three/particles';
import type { Bonus } from '../bonus';
import { NeonFrameTexture, NeonLabelTexture } from '../textures';
import { vfx } from '../vfx';
import { Layer } from '../layers';
import { Ball } from '../Ball';
import { Bolt } from '../Bolt';
import { Brick } from '../Brick';
import { GridSnap } from '../GridSnap';
import { Lifetime } from '../Lifetime';
import { NeonFlicker } from '../NeonFlicker';
import { Pickup } from '../Pickup';
import { Spin } from '../Spin';

/**
 * Bounciness 1 and no friction everywhere: a Breakout ball leaves a surface as fast as it arrived
 * and at the mirror angle, which is what makes a rally readable.
 */
export const bouncy = new PhysicsMaterial2D({ friction: 0, bounciness: 1 });

// --- the arena -----------------------------------------------------------------------------

/**
 * A wall: brushed dark metal with a bevel, its collider, and a neon tube along its inner edge that
 * flickers now and then. A prefab, though it never moves, because the arena places three: what they
 * are made of is edited once, in prefab mode, and what differs — size, where the tube runs, how
 * bright it glows — is each copy's props, on its tag. The defaults are the left wall's.
 *
 * The collider reaches `depth` past the wall, out the way (`outsideX`, `outsideY`) points: its inner face is where the wall's
 * is, but the ball cannot cross it in one step — shoved there by the paddle, or fast into a corner —
 * and come out beyond, as it could through half a metre.
 */
export const WallPrefab = prefab(
  ({
    width = 0.5,
    height = 16.5,
    tubeWidth = 0.07,
    tubeHeight = 16.2,
    tubeAt = [0.29, 0, 0.3],
    glow = 1.5,
    outsideX = -1,
    outsideY = 0,
    depth = 4,
  }: {
    width?: number;
    height?: number;
    tubeWidth?: number;
    tubeHeight?: number;
    tubeAt?: [number, number, number];
    glow?: number;
    outsideX?: number;
    outsideY?: number;
    depth?: number;
  }) => (
    <Group>
      <Mesh>
        <RoundedBoxGeometry args={[width, height, 0.9, 3, 0.2]} />
        <MeshStandardMaterial color="#1b2540" roughness={0.35} metalness={0.75} />
      </Mesh>
      <BoxCollider2D
        size={[width + outsideX * outsideX * depth, height + outsideY * outsideY * depth]}
        offset={[(outsideX * depth) / 2, (outsideY * depth) / 2]}
        material={bouncy}
      />
      <Mesh position={tubeAt}>
        <BoxGeometry args={[tubeWidth, tubeHeight, 0.07]} />
        <MeshStandardMaterial color="#38e1ff" emissive="#38e1ff" emissiveIntensity={2} roughness={0.3} metalness={0.2} />
        <NeonFlicker minDelay={3} maxDelay={5} minLevel={0.85} maxLevel={0.91} />
      </Mesh>
    </Group>
  ),
);

// --- what breaking a brick throws out ------------------------------------------------------

/** Sparks in a tier's colour, gone once they have fallen. One per tier: `instantiate` takes no props. */
export const SoftBurst = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.shatterSoft} />
    <Lifetime seconds={1.2} />
  </Group>
));
export const FirmBurst = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.shatterFirm} />
    <Lifetime seconds={1.2} />
  </Group>
));
export const HardBurst = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.shatterHard} />
    <Lifetime seconds={1.2} />
  </Group>
));
/** By a brick's hits, less one. */
export const bursts = [SoftBurst, FirmBurst, HardBurst];

/** Where a laser bolt strikes. */
export const Spark = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.spark} />
    <Lifetime seconds={0.5} />
  </Group>
));

// --- pickups -------------------------------------------------------------------------------

/** A falling pill with its bonus's word glowing on it in `color`: a trigger the paddle catches. */
const PickupBody = ({ bonus, color, label }: { bonus: Exclude<Bonus, 'none'>; color: string; label: string }) => (
  <Group>
    <Pickup bonus={bonus} />
    <Rigidbody2D gravityScale={0} />
    <BoxCollider2D size={[2.1, 0.72]} isTrigger layer={Layer.pickup} />
    <Mesh>
      <RoundedBoxGeometry args={[2.1, 0.72, 0.5, 4, 0.3]} />
      <MeshStandardMaterial color="#0b0f1a" emissive={color} emissiveIntensity={3.2} roughness={0.25} metalness={0.6}>
        <NeonLabelTexture attach="emissiveMap" args={[label]} />
      </MeshStandardMaterial>
    </Mesh>
  </Group>
);

export const LaserPickup = prefab(() => <PickupBody bonus="laser" color="#ff3b6b" label="LASER" />);
export const MultiPickup = prefab(() => <PickupBody bonus="multi" color="#ffd23f" label="×3" />);
export const WidePickup = prefab(() => <PickupBody bonus="wide" color="#3bff9a" label="WIDE" />);
export const SlimPickup = prefab(() => <PickupBody bonus="slim" color="#b18cff" label="SLIM" />);
/** By `BONUSES`: what a brick with each bonus drops. */
export const pickups = [LaserPickup, MultiPickup, WidePickup, SlimPickup];

// --- the moving parts ----------------------------------------------------------------------

/** By a brick's hits, less one: cyan glass, magenta, heavy amber metal. */
const tierTints = [new Color('#16d9ff'), new Color('#ff3dd8'), new Color('#ffaa1c')];
/** By bonus, in `BONUSES`' order: the colour of the gem that says what a brick drops. */
const gemTints = [new Color('#ff3b6b'), new Color('#ffd23f'), new Color('#3bff9a'), new Color('#b18cff')];

/**
 * One brick, any tier: `hits` picks its colours and its sparks from the tables on `Brick` — cyan
 * glass, magenta, heavy amber metal — and `bonus` what falls out of it, shown by a spinning gem in
 * the bonus's colour on its face. The frame glows from the material's emissive map, in the tier's
 * colour. `GridSnap` keeps it on the wall's grid while it is placed in the editor; `snap={false}`
 * lets one sit between cells.
 */
export const BrickPrefab = prefab(({ hits = 1, bonus = 'none', snap = true }: { hits?: 1 | 2 | 3; bonus?: Bonus; snap?: boolean }) => {
  const gem = ref<Mesh>();
  return (
    <Mesh>
      <RoundedBoxGeometry args={[2.3, 0.72, 0.7, 4, 0.14]} />
      <MeshStandardMaterial emissiveIntensity={2.2} roughness={0.3}>
        <NeonFrameTexture attach="emissiveMap" />
      </MeshStandardMaterial>
      <Brick
        hits={hits}
        bonus={bonus}
        tints={tierTints}
        metalness={[0.25, 0.35, 0.7]}
        bursts={bursts}
        drops={pickups}
        gem={gem}
        gemTints={gemTints}
      />
      <BoxCollider2D size={[2.3, 0.72]} material={bouncy} />
      <GridSnap cell={[2.55, 1]} snap={snap} />
      <Mesh ref={gem} name="gem" position={[0, 0, 0.42]}>
        <OctahedronGeometry args={[0.26]} />
        <MeshStandardMaterial emissiveIntensity={3.5} roughness={0.3} metalness={0.2} />
        <Spin speed={[0, 160, 40]} />
      </Mesh>
    </Mesh>
  );
});

/**
 * The ball, glowing and lighting what it passes, a comet's tail behind it. `copy` is itself: a
 * multi-ball instantiates more of it. Continuous, so a fast ball cannot tunnel through a brick.
 */
export const BallPrefab = prefab(() => (
  <Mesh>
    <SphereGeometry args={[0.32, 32, 24]} />
    <MeshStandardMaterial color="#ffd88a" emissive="#ffd88a" emissiveIntensity={0.82} roughness={0.3} metalness={0.2} />
    <Ball copy={BallPrefab} />
    <Rigidbody2D collisionDetectionMode={CollisionDetectionMode2D.Continuous} gravityScale={0} />
    <CircleCollider2D radius={0.32} material={bouncy} layer={Layer.ball} />
    <ParticleSystem effect={vfx.trail} />
  </Mesh>
));

/** A laser bolt: up, fast, gone at the first thing it strikes. */
export const BoltPrefab = prefab(() => (
  <Mesh>
    <CapsuleGeometry args={[0.07, 0.5, 4, 8]} />
    <MeshStandardMaterial color="#ff5a7d" emissive="#ff5a7d" emissiveIntensity={5} roughness={0.3} metalness={0.2} />
    <Bolt spark={Spark} />
    <Rigidbody2D gravityScale={0} collisionDetectionMode={CollisionDetectionMode2D.Continuous} />
    <BoxCollider2D size={[0.14, 0.64]} isTrigger layer={Layer.bolt} />
  </Mesh>
));
