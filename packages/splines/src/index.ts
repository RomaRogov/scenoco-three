/**
 * `@scenoco-three/splines` — paths, tracks and rails, spelled the way Unity's Splines package spells them.
 *
 * ```tsx
 * const track = ref<Group>();
 * <Group ref={track}>
 *   <SplineContainer closed knots={[[0, 0, 0], [40, 0, 10], { position: [60, 2, 50], roll: 0.2 }, [0, 0, 60]]} />
 * </Group>
 * <Mesh receiveShadow>
 *   <SplineMesh container={track} mesh={models.roadPiece} />
 * </Mesh>
 * <Group>
 *   <SplineInstantiate container={track} itemsToInstantiate={[Barrier]} spacing={6} positionOffset={[5, 0, 0]} />
 * </Group>
 * <Mesh geometry={models.car.geometry}>
 *   <SplineAnimate container={track} animationMethod="speed" maxSpeed={20} />
 * </Mesh>
 * ```
 *
 * - `SplineContainer` — the knots, `closed`; `evaluatePosition/Tangent/UpVector(t)` in world space,
 *   `calculateLength()`. `t` is 0..1 along the length.
 * - `SplineMesh` — bends a modelled piece (a road section, a rail, a fence) along it, repeated to cover it.
 * - `SplineExtrude` — a tube or a square tube along it: a pipe, a cable.
 * - `SplineInstantiate` — prefabs along it, by count or by spacing.
 * - `SplineAnimate` — moves its node along it, by duration or by speed; loops, ping-pongs.
 * - `Spline`, `SplineUtility.getNearestPoint` — the curve itself, in its container's space.
 *
 * The components point at a spline with `container={ref}` — a ref to the node holding the
 * `SplineContainer` — or use the one on their own node.
 */
export { Spline, SplineUtility, type BezierKnot } from './Spline.js';
export { SplineContainer } from './SplineContainer.js';
export { SplineExtrude } from './SplineExtrude.js';
export { SplineInstantiate } from './SplineInstantiate.js';
export { SplineAnimate } from './SplineAnimate.js';
export { SplineMesh } from './SplineMesh.js';
