import { Group, Mesh } from 'three';
import { prefab, ref } from '@scenoco-three/core';
import { BoxCollider2D, CircleCollider2D, CollisionDetectionMode2D, PhysicsMaterial2D, Rigidbody2D } from '@scenoco-three/box2d';
import { ParticleSystem } from '@scenoco-three/particles';
import { geometry, paint, type Bonus } from '../assets';
import { vfx } from '../vfx';
import { Layer } from '../layers';
import { Ball } from '../Ball';
import { Bolt } from '../Bolt';
import { Brick } from '../Brick';
import { GridSnap } from '../GridSnap';
import { Lifetime } from '../Lifetime';
import { Pickup } from '../Pickup';
import { Spin } from '../Spin';

/**
 * Bounciness 1 and no friction everywhere: a Breakout ball leaves a surface as fast as it arrived
 * and at the mirror angle, which is what makes a rally readable.
 */
export const bouncy = new PhysicsMaterial2D({ friction: 0, bounciness: 1 });

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

/** A falling pill with its bonus's word on it: a trigger the paddle catches. */
const PickupBody = ({ bonus }: { bonus: Exclude<Bonus, 'none'> }) => {
  const face = ref<Mesh>();
  return (
    <Group>
      <Pickup bonus={bonus} face={face} looks={paint.pickups} />
      <Rigidbody2D gravityScale={0} />
      <BoxCollider2D size={[2.1, 0.72]} isTrigger layer={Layer.pickup} />
      <Mesh ref={face} geometry={geometry.pickup} />
    </Group>
  );
};

export const LaserPickup = prefab(() => <PickupBody bonus="laser" />);
export const MultiPickup = prefab(() => <PickupBody bonus="multi" />);
export const WidePickup = prefab(() => <PickupBody bonus="wide" />);
export const SlimPickup = prefab(() => <PickupBody bonus="slim" />);
/** By `BONUSES`: what a brick with each bonus drops. */
export const pickups = [LaserPickup, MultiPickup, WidePickup, SlimPickup];

// --- the moving parts ----------------------------------------------------------------------

/**
 * One brick, any tier: `hits` picks its look and its sparks from the tables it is handed, `bonus`
 * what falls out of it — shown by a spinning gem in the bonus's colour on its face. `GridSnap` keeps
 * it on the wall's grid while it is placed in the editor; `snap={false}` lets one sit between cells.
 */
export const BrickPrefab = prefab(({ hits = 1, bonus = 'none', snap = true }: { hits?: 1 | 2 | 3; bonus?: Bonus; snap?: boolean }) => {
  const gem = ref<Mesh>();
  return (
    <Mesh geometry={geometry.brick}>
      <Brick hits={hits} bonus={bonus} looks={paint.tiers} bursts={bursts} drops={pickups} gem={gem} gems={paint.gems} />
      <BoxCollider2D size={[2.3, 0.72]} material={bouncy} />
      <GridSnap cell={[2.55, 1]} snap={snap} />
      <Mesh ref={gem} name="gem" position={[0, 0, 0.42]} geometry={geometry.gem}>
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
  <Mesh geometry={geometry.ball} material={paint.ball}>
    <Ball copy={BallPrefab} />
    <Rigidbody2D collisionDetectionMode={CollisionDetectionMode2D.Continuous} gravityScale={0} />
    <CircleCollider2D radius={0.32} material={bouncy} layer={Layer.ball} />
    <ParticleSystem effect={vfx.trail} />
  </Mesh>
));

/** A laser bolt: up, fast, gone at the first thing it strikes. */
export const BoltPrefab = prefab(() => (
  <Mesh geometry={geometry.bullet} material={paint.bullet}>
    <Bolt spark={Spark} />
    <Rigidbody2D gravityScale={0} collisionDetectionMode={CollisionDetectionMode2D.Continuous} />
    <BoxCollider2D size={[0.14, 0.64]} isTrigger layer={Layer.bolt} />
  </Mesh>
));
