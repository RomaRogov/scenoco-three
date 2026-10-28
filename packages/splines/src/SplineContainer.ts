import { Matrix4, Object3D, Vector3 } from 'three';
import { Behaviour, Event } from '@scenoco-three/core';
import { Spline, type BezierKnot } from './Spline.js';

/**
 * Holds a spline on its node — Unity's `SplineContainer`. The knots are in the node's space; what it
 * evaluates is in the world's.
 *
 * ```tsx
 * <Group>
 *   <SplineContainer closed knots={[[0, 0, 0], [40, 0, 10], { position: [60, 2, 50], roll: 0.2 }, [0, 0, 60]]} />
 * </Group>
 * ```
 *
 * Or the knots are nodes: `knots={points}`, a ref to a node whose children are the knots, in order.
 * The editor's gizmo moves them and the spline follows as they move. Each child's position is a
 * knot's, read in the container's space; its tangents are made smooth, as a bare position's are.
 *
 * ```tsx
 * const points = ref<Group>();
 * <Group>
 *   <SplineContainer knots={points} />
 *   <Group ref={points}>
 *     <Object3D position={[0, 0, 0]} />
 *     <Object3D position={[40, 0, 10]} />
 *     <Object3D position={[60, 2, 50]} />
 *   </Group>
 * </Group>
 * ```
 */
export class SplineContainer extends Behaviour {
  /** The knots, in order — positions or Unity's knot fields — or a node whose children are. Assign a new array to change the shape. */
  knots: BezierKnot[] | Object3D = [];
  /** The last knot joins back to the first. */
  closed = false;

  /**
   * After the knots, `closed`, a knot node — moved, added, removed — or the node's place in the world changed —
   * seen once a frame, in its `update`, and at once on an edit in the editor; a knot changed inside
   * the array is not seen. `SplineMesh`, `SplineExtrude`, `SplineInstantiate` and `SplineAnimate`
   * follow it.
   */
  readonly changed = new Event<[]>();

  #built: Spline | null = null;
  #builtFrom: [BezierKnot[] | Object3D, boolean] | null = null;
  /** What `changed` compares against: the knots, `closed`, where the knot nodes stood and the world matrix. */
  #seen: { knots: BezierKnot[] | Object3D; closed: boolean; nodes: number[]; world: Matrix4 } | null = null;

  override start(): void {
    this.#seen = { knots: this.knots, closed: this.closed, nodes: this.nodePositions(), world: this.world().clone() };
  }

  override update(): void {
    const seen = this.#seen!;
    const world = this.world();
    const nodes = this.nodePositions();
    if (seen.knots === this.knots && seen.closed === this.closed && sameNumbers(seen.nodes, nodes) && seen.world.equals(world)) return;
    this.#built = null;
    this.see(nodes);
    this.changed.emit();
  }

  /** Changed in the editor — a field, a knot node, or the node itself: built again and said at once. */
  override onValidate(): void {
    this.#built = null;
    if (this.#seen) this.see(this.nodePositions());
    this.changed.emit();
  }

  /** The spline, in this node's space — Unity's `Spline`. */
  get spline(): Spline {
    if (!this.#built || this.#builtFrom?.[0] !== this.knots || this.#builtFrom[1] !== this.closed) {
      this.#built = new Spline(this.localKnots(), this.closed);
      this.#builtFrom = [this.knots, this.closed];
    }
    return this.#built;
  }

  /** The point at `t`, 0..1 along the length, in world space. */
  evaluatePosition(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluatePosition(t, target).applyMatrix4(this.world());
  }

  /** The direction at `t`, in world space, unit length. */
  evaluateTangent(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluateTangent(t, target).transformDirection(this.world());
  }

  /** The up vector at `t`, in world space, unit length. */
  evaluateUpVector(t: number, target = new Vector3()): Vector3 {
    return this.spline.evaluateUpVector(t, target).transformDirection(this.world());
  }

  /** The length in world units: the spline's own length, scaled with its node. */
  calculateLength(): number {
    return this.spline.getLength() * this.world().getMaxScaleOnAxis();
  }

  private world() {
    this.node.updateWorldMatrix(true, false);
    return this.node.matrixWorld;
  }

  private see(nodes: number[]): void {
    const seen = this.#seen!;
    seen.knots = this.knots;
    seen.closed = this.closed;
    seen.nodes = nodes;
    seen.world.copy(this.world());
  }

  /** The knots as positions and knot fields: each knot node's position read in this node's space. */
  private localKnots(): BezierKnot[] {
    if (!(this.knots instanceof Object3D)) return this.knots;
    return this.knots.children.map((knot) => this.local(knot).toArray() as [number, number, number]);
  }

  /** Where the knot nodes stand in this node's space, flat — empty when the knots are not nodes. */
  private nodePositions(): number[] {
    return this.knots instanceof Object3D ? this.knots.children.flatMap((knot) => this.local(knot).toArray()) : [];
  }

  private local(knot: Object3D): Vector3 {
    this.world();
    knot.updateWorldMatrix(true, false);
    return this.node.worldToLocal(knot.getWorldPosition(new Vector3()));
  }
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/**
 * The container a spline component works on: the one it was given — a node, which is searched for
 * its `SplineContainer` the way Unity takes a GameObject dropped on the field — or its own node's.
 */
export function containerFor(owner: Behaviour, given: SplineContainer | Object3D | null, who: string): SplineContainer {
  const found = given instanceof Object3D ? given.getComponent(SplineContainer) : (given ?? owner.getComponent(SplineContainer));
  if (!found) {
    throw new Error(
      `${who} has no spline: give it container={track}, a ref to the node holding the <SplineContainer>, ` +
        'or put a <SplineContainer> on its own node.',
    );
  }
  return found;
}
