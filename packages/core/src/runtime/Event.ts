/**
 * A typed event — the sanctioned way two components talk without importing each
 * other.
 *
 * Deliberately **not** a string-keyed bus (`emit('brick-destroyed')`). An event
 * is a class field, so the compiler checks the name, the argument types, and
 * every subscriber; a typo is a build error rather than a listener that silently
 * never fires. Shaped like a C# event, minus the strings.
 *
 *   class Brick extends Component {
 *     points = 10;
 *     readonly destroyed = new Event<[Brick]>();
 *     hit() { this.destroyed.emit(this); this.object3D.destroy(); }
 *   }
 *
 *   class Scoreboard extends Component {
 *     /** Bricks to score. *␀/
 *     bricks: Brick[] = [];
 *     score = 0;
 *     override start() { for (const b of this.bricks) this.listen(b.destroyed, this.onBrick); }
 *     private onBrick = (brick: Brick) => { this.score += brick.points; };
 *   }
 *
 * References point **down** (a field holding the thing you own); events
 * travel **up and out**. That is what keeps two components from importing each
 * other — the cycle that a component graph otherwise grows into.
 *
 * Prefer `Component.listen`, which unsubscribes automatically when the listener
 * is destroyed; use `on`/`off` directly only outside a component's lifetime.
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
   * Invoke every listener in subscription order. Iterates a snapshot, so a
   * listener may subscribe, unsubscribe, or destroy things while it runs without
   * disturbing the dispatch in progress.
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
