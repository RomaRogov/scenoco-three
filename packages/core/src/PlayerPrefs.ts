/**
 * Unity's `PlayerPrefs`: small values kept between visits, in the page's `localStorage` under the
 * keys given. Where the browser refuses storage — a private window, blocked site data, no page at
 * all — values are kept in memory for this visit instead, and the game plays on.
 */
export const PlayerPrefs = {
  getInt(key: string, defaultValue = 0): number {
    const value = Number.parseInt(read(key) ?? '', 10);
    return Number.isNaN(value) ? defaultValue : value;
  },

  /** Stored as a whole number: a fraction is cut off, as Unity's int is. */
  setInt(key: string, value: number): void {
    write(key, String(Math.trunc(value)));
  },

  getFloat(key: string, defaultValue = 0): number {
    const value = Number.parseFloat(read(key) ?? '');
    return Number.isNaN(value) ? defaultValue : value;
  },

  setFloat(key: string, value: number): void {
    write(key, String(value));
  },

  getString(key: string, defaultValue = ''): string {
    return read(key) ?? defaultValue;
  },

  setString(key: string, value: string): void {
    write(key, value);
  },

  hasKey(key: string): boolean {
    return read(key) !== null;
  },

  deleteKey(key: string): void {
    memory.delete(key);
    attempt(() => localStorage.removeItem(key));
  },

  /** Every key: the whole `localStorage` of the game's page. */
  deleteAll(): void {
    memory.clear();
    attempt(() => localStorage.clear());
  },

  /** Nothing to do: every `set` is stored at once. Unity's code calls it, so it is here. */
  save(): void {},
};

/** What could not be stored, for this visit. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  return memory.get(key) ?? attempt(() => localStorage.getItem(key)) ?? null;
}

function write(key: string, value: string): void {
  if (attempt(() => (localStorage.setItem(key, value), true))) memory.delete(key);
  else memory.set(key, value);
}

/** `localStorage` throws where it is refused, and is missing where there is no page. */
function attempt<T>(use: () => T): T | undefined {
  try {
    return use();
  } catch {
    return undefined;
  }
}
