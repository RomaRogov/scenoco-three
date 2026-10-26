/**
 * Unity's `PlayerPrefs`, on localStorage. A browser that refuses storage (a private window, blocked
 * site data) plays on with nothing remembered.
 */
export const PlayerPrefs = {
  getInt(key: string, fallback = 0): number {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : Number.parseInt(value, 10) || fallback;
    } catch {
      return fallback;
    }
  },
  setInt(key: string, value: number): void {
    try {
      localStorage.setItem(key, String(Math.trunc(value)));
    } catch {
      // Nothing remembered: the game still runs.
    }
  },
};
