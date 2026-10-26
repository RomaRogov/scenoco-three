/** What each tower and enemy is, as numbers. Balancing happens here and nowhere else. */

export type TowerKind = 'archer' | 'cannon' | 'mage' | 'frost';
export type EnemyKind = 'goblin' | 'wolf' | 'orc' | 'troll';

export interface TowerLevel {
  damage: number;
  /** Shots per second. */
  rate: number;
  range: number;
  /** Gold to reach this level: the build price for level 1. */
  cost: number;
  /** Cannon: damage falls on everything within this radius of the impact. */
  splash?: number;
  /** Frost: speed multiplier while slowed, and for how long. */
  slow?: number;
  slowFor?: number;
}

export interface TowerSpec {
  name: string;
  /** Mage damage passes through armour. */
  magic: boolean;
  levels: [TowerLevel, TowerLevel, TowerLevel];
  blurb: string;
}

export const TOWERS: Record<TowerKind, TowerSpec> = {
  archer: {
    name: 'Archers',
    magic: false,
    blurb: 'Quick arrows at one target.',
    levels: [
      { damage: 11, rate: 1.3, range: 6.5, cost: 70 },
      { damage: 18, rate: 1.55, range: 7, cost: 60 },
      { damage: 28, rate: 1.85, range: 7.6, cost: 100 },
    ],
  },
  cannon: {
    name: 'Cannon',
    magic: false,
    blurb: 'Slow shells that hit a whole crowd.',
    levels: [
      { damage: 28, rate: 0.5, range: 6.2, cost: 120, splash: 1.7 },
      { damage: 46, rate: 0.55, range: 6.6, cost: 95, splash: 1.9 },
      { damage: 70, rate: 0.62, range: 7.1, cost: 145, splash: 2.2 },
    ],
  },
  mage: {
    name: 'Mage',
    magic: true,
    blurb: 'Magic bolts pierce armour.',
    levels: [
      { damage: 30, rate: 0.75, range: 6, cost: 110 },
      { damage: 52, rate: 0.82, range: 6.5, cost: 95 },
      { damage: 84, rate: 0.92, range: 7, cost: 145 },
    ],
  },
  frost: {
    name: 'Frost',
    magic: true,
    blurb: 'Ice shards slow everything they hit.',
    levels: [
      { damage: 5, rate: 1, range: 5.6, cost: 90, slow: 0.55, slowFor: 1.5 },
      { damage: 9, rate: 1.1, range: 6.1, cost: 70, slow: 0.48, slowFor: 1.8 },
      { damage: 15, rate: 1.25, range: 6.6, cost: 110, slow: 0.4, slowFor: 2.2, splash: 1.1 },
    ],
  },
};

/** The best value of each stat over every tower's top level: the tower sheet's bars are a share of it. */
export const STAT_MAX = { damage: 84, range: 7.6, dps: 26 };

export interface EnemySpec {
  name: string;
  hp: number;
  /** Units per second along the path. */
  speed: number;
  gold: number;
  /** Physical damage taken is multiplied by 1 - armor. */
  armor: number;
  /** Lives lost when it reaches the castle. */
  lives: number;
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  goblin: { name: 'Goblins', hp: 46, speed: 2.1, gold: 6, armor: 0, lives: 1 },
  wolf: { name: 'Wolves', hp: 34, speed: 3.5, gold: 6, armor: 0, lives: 1 },
  orc: { name: 'Orcs', hp: 175, speed: 1.35, gold: 14, armor: 0.35, lives: 2 },
  troll: { name: 'Troll', hp: 950, speed: 0.95, gold: 80, armor: 0.45, lives: 4 },
};

/** Gold back for selling: this share of what went into the tower. */
export const REFUND = 0.7;
