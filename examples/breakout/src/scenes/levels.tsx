import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { CameraRig } from '../CameraRig';
import { GameState } from '../GameState';
import { Arena } from './Arena';
import { BrickPrefab } from './prefabs';

interface LevelProps {
  /** Shown on the HUD. */
  title: string;
  /** How fast the ball travels here. */
  ballSpeed: number;
  /** Where the top row of bricks sits; the bricks are placed from there. */
  wallY: number;
  /** The level's bricks. */
  children?: unknown;
}

/** A level: the shared arena, the level's own rules, and its bricks. */
const Level = ({ title, ballSpeed, wallY, children }: LevelProps) => (
  <Scene>
    <Color attach="background" args={['#02040a']} />
    {/* The far end of the field fades into the dark. */}
    <Fog attach="fog" args={['#02040a', 26, 62]} />
    <GameState levelName={title} ballSpeed={ballSpeed} />

    {/* Little fill, so the neon carries the picture: a cool sky, a warm key from over the camera,
        and a magenta rim from the far side that edges every brick. */}
    <AmbientLight color="#6d8cff" intensity={0.25} />
    <HemisphereLight args={['#5b7cff', '#120a1f', 0.6]} />
    <DirectionalLight color="#ffe8d1" intensity={1.6} position={[4, -6, 14]} />
    <DirectionalLight color="#ff4fd8" intensity={1.4} position={[-6, 18, -6]} />

    {/* Behind the paddle, looking up the field: the near paddle and far wall in perspective. */}
    <PerspectiveCamera near={0.1} far={200} position={[0, -2, 19]}>
      <CameraRig target={[0, 6.994, 0]} />
    </PerspectiveCamera>

    <Arena />
    <Group name="bricks" position={[0, wallY, 0]}>
      {children}
    </Group>
  </Scene>
);

// Every brick is placed here, one element each, so a level is built in the editor: drag a brick
// and it snaps to the wall's grid (`GridSnap`), ⌘D for another, set its `hits` and `bonus`, or
// `snap={false}` to place one off the grid. Positions are from the wall's top centre: 2.55 across,
// 1 down per row.

export const Level1 = () => (
  <Level title="NEON GRID" ballSpeed={14} wallY={13.9}>
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
  </Level>
);

export const Level2 = () => (
  <Level title="FORTRESS" ballSpeed={16} wallY={14.4}>
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
  </Level>
);

export const Level3 = () => (
  <Level title="GAUNTLET" ballSpeed={18} wallY={14.4}>
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
  </Level>
);
