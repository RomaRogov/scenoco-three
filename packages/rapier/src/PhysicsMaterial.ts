import type { Collider } from './colliders.js';

/**
 * How two colliders' values make the one a contact uses — Unity's `PhysicsMaterialCombine`. Where the
 * two ask for different modes, the later in this list wins, as in Unity.
 */
export const PhysicsMaterialCombine = {
  Average: 0,
  Minimum: 1,
  Multiply: 2,
  Maximum: 3,
} as const;
export type PhysicsMaterialCombine = (typeof PhysicsMaterialCombine)[keyof typeof PhysicsMaterialCombine];

type Surface = Pick<PhysicsMaterial, 'friction' | 'bounciness' | 'frictionCombine' | 'bounceCombine'>;

/**
 * Unity's `PhysicsMaterial`: a surface shared by every collider given it, made once in a `.ts`
 * module and set with `material=` — `export const ice = new PhysicsMaterial({ friction: 0.02,
 * frictionCombine: PhysicsMaterialCombine.Minimum })`, then `<BoxCollider material={ice} />`.
 * A change to it reaches every collider using it at once.
 */
export class PhysicsMaterial {
  private _friction = 0.5;
  private _bounciness = 0;
  private _frictionCombine: PhysicsMaterialCombine = PhysicsMaterialCombine.Average;
  private _bounceCombine: PhysicsMaterialCombine = PhysicsMaterialCombine.Average;

  /** @internal the colliders using this material now. */
  readonly _users = new Set<Collider>();

  constructor(init: Partial<Surface> = {}) {
    Object.assign(this, init);
  }

  /** Resistance to sliding: 0 is ice. One coefficient, for sliding and at rest alike. */
  get friction(): number {
    return this._friction;
  }
  set friction(value: number) {
    this._friction = value;
    this.changed();
  }

  /** 0 stops dead, 1 bounces back as high. */
  get bounciness(): number {
    return this._bounciness;
  }
  set bounciness(value: number) {
    this._bounciness = value;
    this.changed();
  }

  get frictionCombine(): PhysicsMaterialCombine {
    return this._frictionCombine;
  }
  set frictionCombine(value: PhysicsMaterialCombine) {
    this._frictionCombine = value;
    this.changed();
  }

  get bounceCombine(): PhysicsMaterialCombine {
    return this._bounceCombine;
  }
  set bounceCombine(value: PhysicsMaterialCombine) {
    this._bounceCombine = value;
    this.changed();
  }

  private changed(): void {
    for (const collider of this._users) collider._applySurface();
  }
}
