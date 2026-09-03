import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three';

/** Crate positions, as `(x, z)`. Fixed: nothing in this game is random. */
const CRATES: ReadonlyArray<readonly [number, number]> = [
  [-6, -6],
  [-3, 5],
  [2, 7],
  [6, 3],
  [7, -4],
  [-7, 2],
  [4, -7],
  [-2, -8],
  [8, 6],
  [-8, -2],
];

const SPEED = 6;
const BOUNDS = 9.5;
const PICKUP_RADIUS = 1;
const DEPOT_RADIUS = 2;
const STACK_SPACING = 0.62;
const STACK_LIFT = 0.31;
const DURATION = 60;

/**
 * The yard, in plain three.js.
 *
 * One class owns the scene, the state and the step. That is the shape a small game of this size
 * takes when nothing else imposes one: there is no component system to hang behaviour off, so
 * behaviour lives with the objects it moves.
 */
export class Yard {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 200);

  private readonly player: Mesh;
  /** Crates still lying in the arena. */
  private readonly loose: Mesh[] = [];
  /** Crates on the player's back, bottom first. */
  private readonly stack: Mesh[] = [];
  private readonly move = new Vector2();

  /** Everything built here, so `dispose` can give it all back. */
  private readonly owned: Array<BufferGeometry | Material> = [];

  private timeLeft = DURATION;
  private score = 0;

  constructor() {
    this.scene.background = new Color('#0d1117');
    this.camera.position.set(0, 14, 14);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new AmbientLight(new Color('#9fb4d0'), 0.9));
    const key = new DirectionalLight(new Color('#fff6e8'), 2.1);
    key.position.set(6, 16, 8);
    this.scene.add(key);

    this.buildArena();
    this.player = this.buildPlayer();
    this.buildCrates();
  }

  /** The four numbers the game is judged by. */
  get state(): { score: number; carried: number; timeLeft: number; cratesRemaining: number } {
    return {
      score: this.score,
      carried: this.stack.length,
      timeLeft: this.timeLeft,
      cratesRemaining: this.loose.length,
    };
  }

  /** Desired direction, length ≤ 1. Screen-up is −Z. */
  setMove(x: number, y: number): void {
    this.move.set(x, y);
  }

  /**
   * One frame.
   *
   * The order is the specification and it is observable: the clock first, so a crate touched on
   * the frame it reaches zero is not collected; the stack last, so the crates are where the
   * player ended up rather than where it started.
   */
  step(dt: number): void {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft > 0) {
      this.walk(dt);
      this.collect();
      this.deliver();
    }
    this.carry();
  }

  dispose(): void {
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
    this.scene.clear();
  }

  private walk(dt: number): void {
    // Clamped rather than normalised: a half-pushed stick moves at half speed, and a stick in a
    // corner is not faster than one pushed straight.
    const length = this.move.length();
    const scale = length > 1 ? 1 / length : 1;

    const position = this.player.position;
    position.x += this.move.x * scale * SPEED * dt;
    position.z += -this.move.y * scale * SPEED * dt;
    position.x = clamp(position.x, -BOUNDS, BOUNDS);
    position.z = clamp(position.z, -BOUNDS, BOUNDS);
  }

  private collect(): void {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const crate = this.loose[i]!;
      if (distanceXZ(crate, this.player) >= PICKUP_RADIUS) continue;
      this.loose.splice(i, 1);
      this.stack.push(crate);
    }
  }

  private deliver(): void {
    if (this.stack.length === 0) return;
    if (Math.hypot(this.player.position.x, this.player.position.z) >= DEPOT_RADIUS) return;

    this.score += this.stack.length;
    for (const crate of this.stack) this.scene.remove(crate);
    this.stack.length = 0;
  }

  private carry(): void {
    const { x, y, z } = this.player.position;
    for (const [index, crate] of this.stack.entries()) {
      crate.position.set(x, y + 0.8 + STACK_LIFT + index * STACK_SPACING, z);
    }
  }

  private buildArena(): void {
    const ground = new Mesh(
      this.keep(new PlaneGeometry(20, 20)),
      this.keep(new MeshStandardMaterial({ color: new Color('#2b3242'), roughness: 0.95 })),
    );
    ground.name = 'ground';
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const wallGeometry = this.keep(new BoxGeometry(20, 1, 0.5));
    const wallMaterial = this.keep(
      new MeshStandardMaterial({ color: new Color('#3a4358'), roughness: 0.8 }),
    );
    // Centred half a thickness outside the floor's edge, so the inner face is flush with it.
    const walls: Array<[number, number, number]> = [
      [0, -10.25, 0],
      [0, 10.25, 0],
      [-10.25, 0, Math.PI / 2],
      [10.25, 0, Math.PI / 2],
    ];
    for (const [x, z, rotation] of walls) {
      const wall = new Mesh(wallGeometry, wallMaterial);
      wall.name = 'wall';
      wall.position.set(x, 0.5, z);
      wall.rotation.y = rotation;
      this.scene.add(wall);
    }

    const depot = new Mesh(
      this.keep(new CylinderGeometry(2, 2, 0.1, 48)),
      this.keep(new MeshStandardMaterial({ color: new Color('#22c55e'), roughness: 0.5 })),
    );
    depot.name = 'depot';
    depot.position.set(0, 0.05, 0);
    this.scene.add(depot);
  }

  private buildPlayer(): Mesh {
    const player = new Mesh(
      this.keep(new CapsuleGeometry(0.4, 0.8, 8, 16)),
      this.keep(new MeshStandardMaterial({ color: new Color('#3b82f6'), roughness: 0.4, metalness: 0.1 })),
    );
    player.name = 'player';
    player.position.set(0, 0.8, 6);
    this.scene.add(player);
    return player;
  }

  private buildCrates(): void {
    // One geometry and one material for all ten: they are identical, and ten copies of each
    // would be ten times the GPU upload for no difference on screen.
    const geometry = this.keep(new BoxGeometry(0.6, 0.6, 0.6));
    const material = this.keep(
      new MeshStandardMaterial({ color: new Color('#d99a2b'), roughness: 0.6 }),
    );
    for (const [x, z] of CRATES) {
      const crate = new Mesh(geometry, material);
      crate.name = 'crate';
      crate.position.set(x, 0.3, z);
      this.scene.add(crate);
      this.loose.push(crate);
    }
  }

  private keep<T extends BufferGeometry | Material>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function distanceXZ(a: Mesh, b: Mesh): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}
