# API

Every public signature of `@scenoco-three/splines`. Read this instead of `src/`. Everything not here
is three.js, as three.js documents it.

```ts
// ── the curve: Unity's Splines ───────────────────────────────────────────────────────────────
// <Group ref={track}><SplineContainer knots={[[0, 0, 0], [10, 0, 5], [20, 2, 0]]} closed /></Group>
// A component that follows it takes the node: <SplineAnimate container={track} duration={8} />
class SplineContainer extends Behaviour {
  knots: BezierKnot[] | Object3D;        // [] — positions or knot fields, or a node whose children are the knots, in order
  closed: boolean;                       // false: true joins the last knot back to the first
  readonly changed: Event<[]>;           // after the knots, closed, a knot node or this node's place changed
  readonly spline: Spline;               // in this node's space
  evaluatePosition(t: number, target?: Vector3): Vector3;   // world space; t 0..1 along the length
  evaluateTangent(t: number, target?: Vector3): Vector3;    // world space, unit length
  evaluateUpVector(t: number, target?: Vector3): Vector3;   // world space, banked by the knots' roll
  calculateLength(): number;             // world units, scaled with its node
}
type BezierKnot = [number, number, number]   // a position, tangents made smooth from its neighbours — Unity's AutoSmooth
  | { position: [number, number, number]; tangentIn?: [number, number, number]; tangentOut?: [number, number, number]; roll?: number };
class Spline {                           // a cubic Bézier spline in its container's space
  constructor(knots: readonly BezierKnot[], closed?: boolean);
  readonly closed: boolean;
  getLength(): number;
  evaluatePosition(t: number, target?: Vector3): Vector3;
  evaluateTangent(t: number, target?: Vector3): Vector3;
  evaluateUpVector(t: number, target?: Vector3): Vector3;
  distanceToT(distance: number): number; // t at a distance along it, clamped to its ends
}
const SplineUtility: {
  getNearestPoint(spline: Spline, point: Vector3, resolution?: number): { position: Vector3; t: number; distance: number };  // in the spline's space
};

// ── what follows a spline: each takes container={ref}, and is built again when it changes ──
class SplineAnimate extends Behaviour {  // moves its node along it: a train, a camera on a rail, a racer
  container: SplineContainer | Object3D | null;
  animationMethod: 'time' | 'speed';     // 'time': once along in duration seconds; 'speed': at maxSpeed units a second
  duration: number;                      // 1
  maxSpeed: number;                      // 10
  loop: 'once' | 'loopContinuous' | 'pingPong';   // 'loopContinuous'
  alignment: 'splineElement' | 'none';   // 'splineElement' turns the node with the spline; 'none' only moves it
  playOnAwake: boolean;                  // true
  startOffset: number;                   // 0, 0..1 along
  readonly completed: Event<[]>;         // a 'once' run reached the end
  readonly isPlaying: boolean;
  elapsedTime: number;                   // seconds into this run
  normalizedTime: number;                // 0..1 through one pass; a ping-pong's way back counts down
  play(): void;  pause(): void;
  restart(autoplay: boolean): void;
}
class SplineExtrude extends Behaviour<Mesh> {   // a tube along it, into its mesh's geometry: a pipe, a rail, a cable
  container: SplineContainer | Object3D | null;
  shape: 'circle' | 'square';            // 'circle'
  radius: number;                        // 0.25
  sides: number;                         // 8
  segmentsPerUnit: number;               // 4
  capped: boolean;                       // true
  range: Vector2;                        // (0, 1): the part covered, as t from and to
  rebuild(): void;
}
class SplineMesh extends Behaviour<Mesh> {   // a modelled piece bent along it, end to end: a road with its kerbs, a fence
  container: SplineContainer | Object3D | null;
  mesh: Model | BufferGeometry | null;   // the piece: a loaded model or a geometry
  count: number;                         // 0: as many as the piece's own length allows
  rebuild(): void;
}
class SplineInstantiate extends Behaviour {   // copies of prefabs along it, as its node's children: barriers, lamps, posts
  container: SplineContainer | Object3D | null;
  itemsToInstantiate: (Prefab | Model)[];   // taking turns
  method: 'instanceCount' | 'spacingDistance';   // 'spacingDistance'
  instanceCount: number;                 // 10
  spacing: number;                       // 2, world units
  positionOffset: Vector3;
  rotationOffset: Euler;
  alignTo: 'splineElement' | 'world';    // 'splineElement': each faces along the spline
  readonly instances: readonly Object3D[];
  rebuild(): void;                       // the old copies are destroyed
}
```
