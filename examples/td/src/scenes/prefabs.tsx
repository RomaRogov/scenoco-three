import { Group, Mesh, Sprite } from 'three';
import { prefab, ref } from '@scenoco-three/core';
import { ParticleSystem } from '@scenoco-three/particles';
import { models, paint, shapes } from '../assets';
import { AutoDestroy } from '../AutoDestroy';
import { BuildPad } from '../BuildPad';
import { Castle } from '../Castle';
import { Enemy } from '../Enemy';
import { HealthBar } from '../HealthBar';
import { ModelView } from '../ModelView';
import { PlaceOnPath } from '../PlaceOnPath';
import { Projectile } from '../Projectile';
import { Punch } from '../Punch';
import { SelectionMarker } from '../SelectionMarker';
import { SnapToGround } from '../SnapToGround';
import { Spin } from '../Spin';
import { Tower } from '../Tower';
import { vfx } from '../vfx';

// ── effects: one-off bursts that clean up after themselves ──────────────────────────────────

export const Explosion = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.explosion} />
    <Group>
      <ParticleSystem effect={vfx.smoke} />
    </Group>
    <AutoDestroy seconds={1.6} />
  </Group>
));

export const ArrowHit = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.arrowHit} />
    <AutoDestroy seconds={0.6} />
  </Group>
));

export const MagicHit = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.magicHit} />
    <AutoDestroy seconds={0.8} />
  </Group>
));

export const FrostHit = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.frostHit} />
    <AutoDestroy seconds={0.8} />
  </Group>
));

export const DeathPuff = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.death} />
    <AutoDestroy seconds={1} />
  </Group>
));

export const CoinBurst = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.coins} />
    <AutoDestroy seconds={1} />
  </Group>
));

export const BuildDust = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.dust} />
    <AutoDestroy seconds={1.2} />
  </Group>
));

export const UpgradeBurst = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.upgrade} />
    <AutoDestroy seconds={1.4} />
  </Group>
));

export const Muzzle = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.muzzle} />
    <AutoDestroy seconds={0.5} />
  </Group>
));

export const CastleHit = prefab(() => (
  <Group>
    <ParticleSystem effect={vfx.castleHit} />
    <AutoDestroy seconds={1} />
  </Group>
));

// ── projectiles ─────────────────────────────────────────────────────────────────────────────

export const Arrow = prefab(() => (
  <Group>
    <Projectile flight="lob" speed={17} arc={0.1} hit={ArrowHit} hitSound="hit" />
    <ModelView model={models.arrow} seat={false} castShadow={false} />
  </Group>
));

export const Cannonball = prefab(() => (
  <Group>
    <Projectile flight="lob" speed={9} arc={0.32} spin={9} hit={Explosion} hitSound="boom" shake={0.12} />
    <ModelView model={models.cannonball} seat={false} castShadow={false} />
  </Group>
));

export const MagicBolt = prefab(() => (
  <Group>
    <Projectile flight="homing" speed={10} hit={MagicHit} />
    <ParticleSystem effect={vfx.orbTrail} />
  </Group>
));

export const IceShard = prefab(() => (
  <Group>
    <Projectile flight="homing" speed={13} hit={FrostHit} hitSound="frost" />
    <ModelView model={models.shard} seat={false} castShadow={false} />
  </Group>
));

// ── enemies ─────────────────────────────────────────────────────────────────────────────────

/** A bar over an enemy's head, `y` units up. */
const HealthBarAt = ({ y }: { y: number }) => {
  const fill = ref<Sprite>();
  return (
    <Group position={[0, y, 0]}>
      <HealthBar fill={fill} width={0.9} />
      <Sprite material={paint.hpBack} scale={[0.98, 0.15, 1]} renderOrder={10} />
      <Sprite ref={fill} material={paint.hpFill} scale={[0.9, 0.09, 1]} renderOrder={11} />
    </Group>
  );
};

/** Ice motes while slowed. */
const Chill = ({ link }: { link: { current: Group | null } }) => (
  <Group ref={link} visible={false} position={[0, 0.3, 0]}>
    <ParticleSystem effect={vfx.chill} />
  </Group>
);

export const Goblin = prefab(() => {
  const body = ref<Group>();
  const chill = ref<Group>();
  return (
    <Group name="goblin">
      <Enemy kind="goblin" body={body} chill={chill} puff={DeathPuff} aim={0.8} />
      <Group ref={body}>
        <ModelView model={models.goblin} height={1.7} />
      </Group>
      <HealthBarAt y={2.05} />
      <Chill link={chill} />
    </Group>
  );
});

export const Wolf = prefab(() => {
  const body = ref<Group>();
  const chill = ref<Group>();
  return (
    <Group name="wolf">
      <Enemy kind="wolf" body={body} chill={chill} puff={DeathPuff} aim={0.65} />
      <Group ref={body}>
        <ModelView model={models.wolf} height={1.35} />
      </Group>
      <HealthBarAt y={1.7} />
      <Chill link={chill} />
    </Group>
  );
});

export const Orc = prefab(() => {
  const body = ref<Group>();
  const chill = ref<Group>();
  return (
    <Group name="orc">
      <Enemy kind="orc" body={body} chill={chill} puff={DeathPuff} aim={1.1} />
      <Group ref={body}>
        <ModelView model={models.orc} height={2.25} />
      </Group>
      <HealthBarAt y={2.65} />
      <Chill link={chill} />
    </Group>
  );
});

export const Troll = prefab(() => {
  const body = ref<Group>();
  const chill = ref<Group>();
  return (
    <Group name="troll">
      <Enemy kind="troll" body={body} chill={chill} puff={DeathPuff} aim={1.6} />
      <Group ref={body}>
        <ModelView model={models.troll} height={3.4} />
      </Group>
      <HealthBarAt y={3.8} />
      <Chill link={chill} />
    </Group>
  );
});

// ── towers ──────────────────────────────────────────────────────────────────────────────────

/** Three stars circling over a tower, `y` up; the tower lights one per level. */
const Stars = ({ y, link }: { y: number; link: { current: Group | null } }) => (
  <Group position={[0, y, 0]}>
    <Spin speed={1.2} bob={0.06} />
    <Group ref={link}>
      <Sprite material={paint.star} position={[-0.42, 0, 0]} scale={0.38} renderOrder={12} />
      <Sprite material={paint.star} position={[0, 0.1, 0]} scale={0.42} renderOrder={12} />
      <Sprite material={paint.star} position={[0.42, 0, 0]} scale={0.38} renderOrder={12} />
    </Group>
  </Group>
);

/** The golden motes around a tower at its last level. */
const Aura = ({ link }: { link: { current: Group | null } }) => (
  <Group ref={link} visible={false} position={[0, 0.3, 0]}>
    <ParticleSystem effect={vfx.aura} />
  </Group>
);

export const ArcherTower = prefab(() => {
  const body = ref<Group>();
  const stars = ref<Group>();
  const aura = ref<Group>();
  return (
    <Group name="archer tower">
      <Tower kind="archer" projectile={Arrow} upgradeBurst={UpgradeBurst} body={body} stars={stars} aura={aura} sound="arrow" muzzle={2.6} />
      <Group ref={body}>
        <Punch popIn />
        <ModelView model={models.archer} width={2.4} />
      </Group>
      <Stars y={3.9} link={stars} />
      <Aura link={aura} />
    </Group>
  );
});

export const CannonTower = prefab(() => {
  const body = ref<Group>();
  const stars = ref<Group>();
  const aura = ref<Group>();
  return (
    <Group name="cannon tower">
      <Tower kind="cannon" projectile={Cannonball} flash={Muzzle} upgradeBurst={UpgradeBurst} body={body} stars={stars} aura={aura} sound="cannon" muzzle={1.9} turns facing={180} />
      <Group ref={body}>
        <Punch popIn />
        <ModelView model={models.cannon} width={2.4} />
      </Group>
      <Stars y={3} link={stars} />
      <Aura link={aura} />
    </Group>
  );
});

export const MageTower = prefab(() => {
  const body = ref<Group>();
  const stars = ref<Group>();
  const aura = ref<Group>();
  return (
    <Group name="mage tower">
      <Tower kind="mage" projectile={MagicBolt} upgradeBurst={UpgradeBurst} body={body} stars={stars} aura={aura} sound="magic" muzzle={3.1} />
      <Group ref={body}>
        <Punch popIn />
        <ModelView model={models.mage} width={2.1} />
      </Group>
      <Stars y={4.1} link={stars} />
      <Aura link={aura} />
    </Group>
  );
});

export const FrostTower = prefab(() => {
  const body = ref<Group>();
  const stars = ref<Group>();
  const aura = ref<Group>();
  return (
    <Group name="frost tower">
      <Tower kind="frost" projectile={IceShard} upgradeBurst={UpgradeBurst} body={body} stars={stars} aura={aura} sound="frost" muzzle={2.4} />
      <Group ref={body}>
        <Punch popIn />
        <ModelView model={models.frost} width={2.3} />
      </Group>
      <Stars y={3.5} link={stars} />
      <Aura link={aura} />
    </Group>
  );
});

// ── the map's pieces ────────────────────────────────────────────────────────────────────────

/** A stone pad a tower can be built on, seated on the ground. */
export const Pad = prefab(() => {
  const ring = ref<Mesh>();
  return (
    <Group>
      <SnapToGround radius={1.1} offset={0.099} />
      <BuildPad ring={ring} />
      <ModelView model={models.pad} width={2.5} castShadow={false} receiveShadow />
      <Mesh ref={ring} geometry={shapes.ring} material={paint.ring} position={[0, 0.24, 0]} visible={false} />
    </Group>
  );
});

export const Lantern = prefab(() => (
  <Group>
    <SnapToGround />
    <ModelView model={models.lantern} height={1.7} />
  </Group>
));

/** The castle at the end of the path. */
export const Keep = prefab(() => (
  <Group name="castle">
    <PlaceOnPath t={1} offset={[0, -0.1, 0.205]} yaw={180} radius={2.2} />
    <Castle flare={CastleHit} />
    <Group>
      <Punch />
      <ModelView model={models.castle} height={5.2} />
    </Group>
  </Group>
));

/** The cave the enemies come out of. */
export const Lair = prefab(() => (
  <Group name="cave">
    <PlaceOnPath t={0.022} offset={[0, -0.08, -1.6]} radius={1.6} />
    <ModelView model={models.cave} height={3.4} />
    <Group position={[0, 0.6, 1]}>
      <ParticleSystem effect={vfx.embers} />
    </Group>
  </Group>
));

export const Bridge = prefab(({ t }: { t: number }) => (
  <Group name="bridge">
    <PlaceOnPath t={0.533} offset={[-0.684, 0.292, -0.124]} yaw={-1.408} radius={0} />
    <ModelView model={models.bridge} receiveShadow />
  </Group>
));

/** The selected tower's reach. */
export const RangeMarker = prefab(() => (
  <Group name="range">
    <SelectionMarker material={paint.reach} />
  </Group>
));
