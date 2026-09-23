/**
 * A typed event — how two components talk without importing each other. A C# event, minus the
 * strings.
 *
 * Deliberately **not** a string-keyed bus: an event is a class field, so a typo is a build
 * error rather than a listener that silently never fires. References point down, at what you
 * own; events travel up and out.
 *
 * Prefer `Component.listen`, which unsubscribes on destroy; `on`/`off` are for outside a
 * component's lifetime.
 */
export class Event<TArgs extends unknown[] = []> {
  private listeners: ((...args: TArgs) => void)[] = [];

  /** Subscribe. Adding the same function twice subscribes it twice (as with `+=`). */
  on(listener: (...args: TArgs) => void): void {
    this.listeners.push(listener);
  }

  /** Unsubscribe one registration of `listener`; a listener never added is ignored. */
  off(listener: (...args: TArgs) => void): void {
    const i = this.listeners.indexOf(listener);
    if (i !== -1) this.listeners.splice(i, 1);
  }

  /** Subscribe for the next emit only, then unsubscribe. */
  once(listener: (...args: TArgs) => void): void {
    const wrapper = (...args: TArgs): void => {
      this.off(wrapper);
      listener(...args);
    };
    this.on(wrapper);
  }

  /**
   * Invoke every listener in subscription order, over a snapshot, so a listener may subscribe,
   * unsubscribe or destroy freely.
   */
  emit(...args: TArgs): void {
    for (const listener of this.listeners.slice()) listener(...args);
  }

  /** Drop every listener. */
  clear(): void {
    this.listeners.length = 0;
  }

  /** How many listeners are subscribed — for assertions and leak checks. */
  get listenerCount(): number {
    return this.listeners.length;
  }
}
