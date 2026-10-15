import { AmbientLight, Color, DirectionalLight, Fog, Group, PerspectiveCamera, Scene } from 'three';
import { BrickField } from '../BrickField';
import { CameraFit } from '../CameraFit';
import { GameState } from '../GameState';
import { Arena } from './Arena';

interface LevelProps {
  /** Shown on the HUD. */
  name: string;
  /** How fast the ball travels here. */
  ballSpeed: number;
  /** The wall, one string per row: a digit is a brick taking that many hits, anything else a gap. */
  rows: string[];
  /** Where the top row sits. */
  wallY: number;
}

/** A level: the shared arena, the level's own rules, and its wall of bricks. */
const Level = ({ name, ballSpeed, rows, wallY }: LevelProps) => (
  <Scene>
    <Color attach="background" args={['#05070d']} />
    {/* A haze at the far end of the field. */}
    <Fog attach="fog" args={['#05070d', 20, 46]} />
    <GameState levelName={name} />

    {/* Key light from the front-right, a cool rim from behind-left: enough shape on a flat field
        of boxes to read as depth without hiding anything. */}
    <AmbientLight color="#93c5fd" intensity={1.1} />
    <DirectionalLight color="#fff7ed" intensity={2.6} position={[6, 14, 16]} />
    <DirectionalLight color="#38bdf8" intensity={1.2} position={[-10, 4, -8]} />

    {/* Keeps the whole 21 × 19.5 playfield on screen at any window shape. */}
    <PerspectiveCamera near={0.1} far={200} position={[0, 8.5, 24]}>
      <CameraFit width={21} height={19.5} distance={24} />
    </PerspectiveCamera>

    <Arena ballSpeed={ballSpeed} />
    <Group position={[0, wallY, 0]}>
      <BrickField rows={rows} />
    </Group>
  </Scene>
);

export const Level1 = () => <Level name="NEON GRID" ballSpeed={14} wallY={13.9} rows={['1111111', '1111111', '.11111.']} />;

export const Level2 = () => (
  <Level name="FORTRESS" ballSpeed={16} wallY={14.4} rows={['.22222.', '2111112', '2133312', '2111112', '.22222.']} />
);

export const Level3 = () => (
  <Level name="GAUNTLET" ballSpeed={18} wallY={14.4} rows={['3.3.3.3', '.2.2.2.', '1111111', '.2.2.2.', '3.3.3.3']} />
);
