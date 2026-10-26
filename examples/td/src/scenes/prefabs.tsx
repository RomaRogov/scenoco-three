import { Group, Mesh, Sprite } from 'three';
import { ref } from '@scenoco-three/core';
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

export const Explosion = () => (
  <Group>
    <ParticleSystem effect={vfx.explosion} />
    <Group>
      <ParticleSystem effect={vfx.smoke} />
    </Group>
    <AutoDestroy seconds={1.6} />
  </Group>
);

export const ArrowHit = () => (
  <Group>
    <ParticleSystem effect={vfx.arrowHit} />
    <AutoDestroy seconds={0.6} />
  </Group>
);

export const MagicHit = () => (
  <Group>
    <ParticleSystem effect={vfx.magicHit} />
    <AutoDestroy seconds={0.8} />
  </Group>
);

export const FrostHit = () => (
  <Group>
    <ParticleSystem effect={vfx.frostHit} />
    <AutoDestroy seconds={0.8} />
  </Group>
);

export const DeathPuff = () => (
  <Group>
    <ParticleSystem effect={vfx.death} />
    <AutoDestroy seconds={1} />
  </Group>
);

export const CoinBurst = () => (
  <Group>
    <ParticleSystem effect={vfx.coins} />
    <AutoDestroy seconds={1} />
  </Group>
);

export const BuildDust = () => (
  <Group>
    <ParticleSystem effect={vfx.dust} />
    <AutoDestroy seconds={1.2} />
  </Group>
);

export const UpgradeBurst = () => (
  <Group>
    <ParticleSystem effect={vfx.upgrade} />
    <AutoDestroy seconds={1.4} />
  </Group>
);

export const Muzzle = () => (
  <Group>
    <ParticleSystem effect={vfx.muzzle} />
    <AutoDestroy seconds={0.5} />
  </Group>
);

export const CastleHit = () => (
  <Group>
    <ParticleSystem effect={vfx.castleHit} />
    <AutoDestroy seconds={1} />
  </Group>
);

// ── projectiles ─────────────────────────────────────────────────────────────────────────────

export const Arrow = () => (
  <Group>
    <Projectile flight="lob" speed={17} arc={0.1} hit={ArrowHit} hitSound="hit" />
    <ModelView model={models.arrow} seat={false} castShadow={false} />
  </Group>
);

export const Cannonball = () => (
  <Group>
    <Projectile flight="lob" speed={9} arc={0.32} spin={9} hit={Explosion} hitSound="boom" shake={0.12} />
    <ModelView model={models.cannonball} seat={false} castShadow={false} />
  </Group>
);

export const MagicBolt = () => (
  <Group>
    <Projectile flight="homing" speed={10} hit={MagicHit} />
    <ParticleSystem effect={vfx.orbTrail} />
  </Group>
);

export const IceShard = () => (
  <Group>
    <Projectile flight="homing" speed={13} hit={FrostHit} hitSound="frost" />
    <ModelView model={models.shard} seat={false} castShadow={false} />
  </Group>
);

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

export const Goblin = () => {
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
};

export const Wolf = () => {
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
};

export const Orc = () => {
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
};

export const Troll = () => {
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
};

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

export const ArcherTower = () => {
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
};

export const CannonTower = () => {
  const body = ref<Group>();
  const stars = ref<Group>();
  const aura = ref<Group>();
  return (
    <Group name="cannon tower">
      <Tower kind="cannon" projectile={Cannonball} flash={Muzzle} upgradeBurst={UpgradeBurst} body={body} stars={stars} aura={aura} sound="cannon" muzzle={1.9} />
      <Group ref={body}>
        <Punch popIn />
        <ModelView model={models.cannon} width={2.4} />
      </Group>
      <Stars y={3} link={stars} />
      <Aura link={aura} />
    </Group>
  );
};

export const MageTower = () => {
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
};

export const FrostTower = () => {
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
};

// ── the map's pieces ────────────────────────────────────────────────────────────────────────

/** A stone pad a tower can be built on, seated on the ground. */
export const Pad = ({ position }: { position: [number, number, number] }) => {
  const ring = ref<Mesh>();
  return (
    <Group position={position}>
      <SnapToGround radius={1.1} offset={-0.05} />
      <BuildPad ring={ring} />
      <ModelView model={models.pad} width={2.5} castShadow={false} receiveShadow />
      <Mesh ref={ring} geometry={shapes.ring} material={paint.ring} position={[0, 0.24, 0]} visible={false} />
    </Group>
  );
};

export const Lantern = () => (
  <Group>
    <SnapToGround />
    <ModelView model={models.lantern} height={1.7} />
  </Group>
);

/** The castle at the end of the path. */
export const Keep = () => (
  <Group name="castle">
    <PlaceOnPath t={1} ahead={-1.2} yaw={180} radius={2.2} offset={-0.1} />
    <Castle flare={CastleHit} />
    <Group>
      <Punch />
      <ModelView model={models.castle} height={5.2} />
    </Group>
  </Group>
);

/** The cave the enemies come out of. */
export const Lair = () => (
  <Group name="cave">
    <PlaceOnPath t={0.012} ahead={-1.6} radius={1.6} offset={-0.2} />
    <ModelView model={models.cave} height={3.4} />
    <Group position={[0, 0.6, 1]}>
      <ParticleSystem effect={vfx.embers} />
    </Group>
  </Group>
);

export const Bridge = ({ t }: { t: number }) => (
  <Group name="bridge">
    <PlaceOnPath t={t} offset={0.02} />
    <ModelView model={models.bridge} receiveShadow />
  </Group>
);

/** The selected tower's reach. */
export const RangeMarker = () => {
  const range = ref<Group>();
  return (
    <Group name="range">
      <SelectionMarker range={range} />
      <Group ref={range}>
        <Mesh geometry={shapes.disc} material={paint.range} renderOrder={2} />
        <Mesh geometry={shapes.edge} material={paint.rangeEdge} renderOrder={3} />
      </Group>
    </Group>
  );
};
