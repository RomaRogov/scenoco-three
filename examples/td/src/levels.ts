import type { BezierKnot } from '@scenoco-three/splines';
import type { EnemyKind } from './data';

/** One group in a wave: `count` of a kind, `gap` seconds apart, starting `at` seconds into the wave. */
export interface Group {
  kind: EnemyKind;
  count: number;
  gap: number;
  at?: number;
}

export interface LevelSpec {
  id: LevelId;
  name: string;
  blurb: string;
  gold: number;
  lives: number;
  /** Enemy health multiplier for the whole level; each wave adds `growth` on top. */
  toughness: number;
  growth: number;
  /** The road the terrain was carved for, in map metres (the terrain node scales them to units). */
  path: BezierKnot[];
  /** A river the terrain was carved for, in map metres: the level's `rivers` in the asset lab. */
  river?: BezierKnot[];
  waves: Group[][];
}

export type LevelId = 'meadow' | 'canyon' | 'frost';

const g = (kind: EnemyKind, count: number, gap: number, at = 0): Group => ({ kind, count, gap, at });

export const LEVELS: Record<LevelId, LevelSpec> = {
  meadow: {
    id: 'meadow',
    name: 'Greenvale',
    blurb: 'A quiet meadow. For now.',
    gold: 260,
    lives: 20,
    toughness: 1,
    growth: 0.08,
    // levels/td-meadow.json in the asset lab: the same knots carved the road.
    path: [[0, 0, -130], [-30, 0, -95], [-38, 0, -60], [0, 0, -40], [35, 0, -20], [30, 0, 15], [-20, 0, 30], [-35, 0, 62], [0, 0, 88], [0, 0, 112]],
    waves: [
      [g('goblin', 8, 1.2)],
      [g('goblin', 12, 0.9)],
      [g('wolf', 8, 0.8), g('goblin', 6, 1, 4)],
      [g('orc', 3, 2.4), g('goblin', 10, 0.8, 2)],
      [g('wolf', 14, 0.6)],
      [g('orc', 6, 1.6), g('goblin', 12, 0.7, 3)],
      [g('wolf', 10, 0.5), g('orc', 6, 1.4, 5)],
      [g('troll', 1, 1), g('goblin', 16, 0.6, 2), g('orc', 4, 1.6, 8)],
    ],
  },
  canyon: {
    id: 'canyon',
    name: 'Stonebrook',
    blurb: 'Orcs ford the stream at dawn.',
    gold: 280,
    lives: 20,
    toughness: 1.1,
    growth: 0.09,
    path: [[-20, 0, -130], [-25, 0, -92], [25, 0, -72], [35, 0, -38], [-10, 0, -18], [-35, 0, 18], [-30, 0, 48], [20, 0, 62], [30, 0, 88], [0, 0, 112]],
    // The lab's river, and on past the map's edges where the ground carries its channel on.
    river: [[-256, 0, -5], [-128, 0, -5], [-60, 0, 5], [0, 0, -8], [60, 0, 6], [128, 0, -4], [256, 0, -4]],
    waves: [
      [g('goblin', 10, 1)],
      [g('wolf', 10, 0.7), g('goblin', 6, 1, 3)],
      [g('orc', 5, 1.8)],
      [g('goblin', 18, 0.6), g('orc', 3, 2, 6)],
      [g('wolf', 18, 0.45)],
      [g('orc', 8, 1.3), g('wolf', 8, 0.6, 6)],
      [g('troll', 1, 1), g('goblin', 14, 0.6, 3)],
      [g('orc', 12, 1), g('wolf', 12, 0.5, 4)],
      [g('goblin', 24, 0.4), g('orc', 8, 1.2, 4)],
      [g('troll', 1, 1), g('orc', 8, 1.1, 3), g('wolf', 12, 0.55, 8), g('troll', 1, 1, 16)],
    ],
  },
  frost: {
    id: 'frost',
    name: 'Frostpeak',
    blurb: 'The trolls come down from the mountains.',
    gold: 360,
    lives: 20,
    toughness: 1.15,
    growth: 0.08,
    path: [[40, 0, -130], [35, 0, -97], [-33, 0, -86], [-40, 0, -56], [30, 0, -46], [38, 0, -16], [-30, 0, -5], [-38, 0, 25], [25, 0, 36], [35, 0, 64], [-5, 0, 84], [0, 0, 112]],
    waves: [
      [g('goblin', 12, 0.9)],
      [g('wolf', 14, 0.6)],
      [g('orc', 6, 1.6), g('goblin', 8, 0.8, 4)],
      [g('wolf', 12, 0.5), g('orc', 5, 1.6, 4)],
      [g('troll', 1, 1), g('goblin', 16, 0.6, 2)],
      [g('orc', 12, 1)],
      [g('wolf', 24, 0.35), g('goblin', 12, 0.6, 5)],
      [g('troll', 2, 5), g('orc', 8, 1.2, 3)],
      [g('orc', 14, 0.9), g('wolf', 16, 0.45, 5)],
      [g('goblin', 22, 0.5), g('troll', 1, 1, 9)],
      [g('troll', 2, 6), g('orc', 10, 1.1, 2)],
      [g('troll', 3, 7), g('orc', 10, 1, 2), g('wolf', 16, 0.45, 10)],
    ],
  },
};

export const LEVEL_ORDER: LevelId[] = ['meadow', 'canyon', 'frost'];
