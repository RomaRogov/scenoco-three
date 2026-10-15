/**
 * A typed event — how two behaviours talk without importing each other. A C# event, minus the
 * strings: it is a class field, so a typo is a build error rather than a listener that never fires.
 *
 * Prefer `Behaviour.listen`, which unsubscribes on destroy; `on`/`off` are for outside a lifetime.
 */
export class Event<TArgs extends unknown[] = []> {
  private listeners: ((...args: TArgs) => void)[] = [];

  on(listener: (...args: TArgs) => void): void {
    this.listeners.push(listener);
  }

  off(listener: (...args: TArgs) => void): void {
    const i = this.listeners.indexOf(listener);
    if (i !== -1) this.listeners.splice(i, 1);
  }

  once(listener: (...args: TArgs) => void): void {
    const wrapper = (...args: TArgs): void => {
      this.off(wrapper);
      listener(...args);
    };
    this.on(wrapper);
  }

  /** Over a snapshot, so a listener may subscribe, unsubscribe or destroy freely. */
  emit(...args: TArgs): void {
    for (const listener of this.listeners.slice()) listener(...args);
  }

  clear(): void {
    this.listeners.length = 0;
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}
