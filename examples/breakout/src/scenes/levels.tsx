import { Color, Fog, Group, Scene } from 'three';
import { Arena } from './Arena';
import { BrickPrefab } from './prefabs';

/**
 * The levels: each a scene of its own — its background and fog, the shared `Arena` prefab named and
 * paced for it, and its bricks, one element each so a level is built in the editor: a dragged brick
 * snaps to the wall's grid (`GridSnap`), 2.55 across and 1 down from the wall's top centre.
 */

export const Level1 = () => (
  <Scene>
    <Color attach="background" args={['#02040a']} />
    <Fog attach="fog" args={['#02040a', 26, 62]} />
    <Arena title="NEON GRID" ballSpeed={14} />
    <Group name="bricks" position={[0, 13.9, 0]}>
      <BrickPrefab position={[-7.65, 0, 0]} hits={2} />
      <BrickPrefab position={[-5.1, 0, 0]} hits={2} />
      <BrickPrefab position={[-2.55, 0, 0]} hits={2} />
      <BrickPrefab position={[0, 0, 0]} hits={2} />
      <BrickPrefab position={[2.55, 0, 0]} hits={2} />
      <BrickPrefab position={[5.1, 0, 0]} hits={2} />
      <BrickPrefab position={[7.65, 0, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -1, 0]} />
      <BrickPrefab position={[-5.1, -1, 0]} bonus="wide" />
      <BrickPrefab position={[-2.55, -1, 0]} />
      <BrickPrefab position={[0, -1, 0]} />
      <BrickPrefab position={[2.55, -1, 0]} />
      <BrickPrefab position={[5.1, -1, 0]} bonus="multi" />
      <BrickPrefab position={[7.65, -1, 0]} />
      <BrickPrefab position={[-5.1, -2, 0]} />
      <BrickPrefab position={[-2.55, -2, 0]} />
      <BrickPrefab position={[0, -2, 0]} bonus="laser" />
      <BrickPrefab position={[2.55, -2, 0]} />
      <BrickPrefab position={[5.1, -2, 0]} />
    </Group>
  </Scene>
);

export const Level2 = () => (
  <Scene>
    <Color attach="background" args={['#02040a']} />
    <Fog attach="fog" args={['#02040a', 26, 62]} />
    <Arena title="FORTRESS" ballSpeed={16} />
    <Group name="bricks" position={[0, 14.4, 0]}>
      <BrickPrefab position={[-5.1, 0, 0]} hits={2} />
      <BrickPrefab position={[-2.55, 0, 0]} hits={2} />
      <BrickPrefab position={[0, 0, 0]} hits={2} />
      <BrickPrefab position={[2.55, 0, 0]} hits={2} />
      <BrickPrefab position={[5.1, 0, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -1, 0]} hits={2} />
      <BrickPrefab position={[-5.1, -1, 0]} bonus="laser" />
      <BrickPrefab position={[-2.55, -1, 0]} />
      <BrickPrefab position={[0, -1, 0]} />
      <BrickPrefab position={[2.55, -1, 0]} />
      <BrickPrefab position={[5.1, -1, 0]} bonus="multi" />
      <BrickPrefab position={[7.65, -1, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -2, 0]} hits={2} />
      <BrickPrefab position={[-5.1, -2, 0]} />
      <BrickPrefab position={[-2.55, -2, 0]} hits={3} />
      <BrickPrefab position={[0, -2, 0]} hits={3} bonus="slim" />
      <BrickPrefab position={[2.55, -2, 0]} hits={3} />
      <BrickPrefab position={[5.1, -2, 0]} />
      <BrickPrefab position={[7.65, -2, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -3, 0]} hits={2} />
      <BrickPrefab position={[-5.1, -3, 0]} bonus="multi" />
      <BrickPrefab position={[-2.55, -3, 0]} />
      <BrickPrefab position={[0, -3, 0]} bonus="wide" />
      <BrickPrefab position={[2.55, -3, 0]} />
      <BrickPrefab position={[5.1, -3, 0]} />
      <BrickPrefab position={[7.65, -3, 0]} hits={2} />
      <BrickPrefab position={[-5.1, -4, 0]} hits={2} />
      <BrickPrefab position={[-2.55, -4, 0]} hits={2} />
      <BrickPrefab position={[0, -4, 0]} hits={2} />
      <BrickPrefab position={[2.55, -4, 0]} hits={2} />
      <BrickPrefab position={[5.1, -4, 0]} hits={2} />
    </Group>
  </Scene>
);

export const Level3 = () => (
  <Scene>
    <Color attach="background" args={['#02040a']} />
    <Fog attach="fog" args={['#02040a', 26, 62]} />
    <Arena title="GAUNTLET" ballSpeed={18} />
    <Group name="bricks" position={[0, 14.4, 0]}>
      <BrickPrefab position={[-7.65, 0, 0]} hits={3} />
      <BrickPrefab position={[-2.55, 0, 0]} hits={3} />
      <BrickPrefab position={[2.55, 0, 0]} hits={3} />
      <BrickPrefab position={[7.65, 0, 0]} hits={3} />
      <BrickPrefab position={[-5.1, -1, 0]} hits={2} />
      <BrickPrefab position={[0, -1, 0]} hits={2} bonus="multi" />
      <BrickPrefab position={[5.1, -1, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -2, 0]} bonus="laser" />
      <BrickPrefab position={[-5.1, -2, 0]} />
      <BrickPrefab position={[-2.55, -2, 0]} />
      <BrickPrefab position={[0, -2, 0]} bonus="multi" />
      <BrickPrefab position={[2.55, -2, 0]} />
      <BrickPrefab position={[5.1, -2, 0]} />
      <BrickPrefab position={[7.65, -2, 0]} bonus="wide" />
      <BrickPrefab position={[-5.1, -3, 0]} hits={2} />
      <BrickPrefab position={[0, -3, 0]} hits={2} bonus="slim" />
      <BrickPrefab position={[5.1, -3, 0]} hits={2} />
      <BrickPrefab position={[-7.65, -4, 0]} hits={3} />
      <BrickPrefab position={[-2.55, -4, 0]} hits={3} />
      <BrickPrefab position={[2.55, -4, 0]} hits={3} />
      <BrickPrefab position={[7.65, -4, 0]} hits={3} />
    </Group>
  </Scene>
);
