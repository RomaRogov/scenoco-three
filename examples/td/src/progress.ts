import type { LevelId } from './levels';

/** Stars earned per level, kept in the browser. Read by the map, written on a win. */
export function loadStars(): Partial<Record<LevelId, number>> {
  try {
    return JSON.parse(localStorage.getItem('tiny-bastion') ?? '{}') as Partial<Record<LevelId, number>>;
  } catch {
    return {};
  }
}

export function saveStars(level: LevelId, stars: number) {
  const all = loadStars();
  all[level] = Math.max(all[level] ?? 0, stars);
  try {
    localStorage.setItem('tiny-bastion', JSON.stringify(all));
  } catch {
    // Private browsing: the run still counts, it just is not remembered.
  }
}
