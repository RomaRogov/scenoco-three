import { Component, Event } from '@scenoco-three/core';

/**
 * Makes a UI element clickable — Unity's `Button`.
 *
 * ```xml
 * <Panel id="retry" anchor="center" y="60" width="220" height="56" background="#2563eb" radius="10"
 *        alignX="center" alignY="center">
 *   <Text text="PLAY AGAIN" fontSize="22" color="#ffffff" />
 *   <Components><Button /></Components>
 * </Panel>
 * ```
 *
 * ```ts
 * retry!: Button;   // retry="#retry" — a slot typed as a component takes the node that carries it
 * override start(): void { this.listen(this.retry.onClick, () => this.restart()); }
 * ```
 *
 * A click on anything inside the element counts — the label is part of the button. Hide the
 * element with `setActive(false)` and it takes no clicks, the same as it takes no space.
 */
export class Button extends Component {
  /** Whether it answers clicks at all. Unity's `interactable`. */
  interactable = true;

  /** Raised once per click. Unity's `onClick`. */
  readonly onClick = new Event();

  private readonly clicked = (): void => {
    if (this.interactable && this.isActiveAndEnabled) this.onClick.emit();
  };

  override awake(): void {
    this.object3D.addEventListener('click', this.clicked);
  }

  override onDestroy(): void {
    this.object3D.removeEventListener('click', this.clicked);
  }
}
