# @scenoco-three/splines

Paths, tracks and rails, in the shape of Unity's Splines package. Part of
[SceNoCo](https://github.com/RomaRogov/scenoco-three).

```tsx
const track = ref<Group>();

<Group ref={track}>
  <SplineContainer closed knots={[[0, 0, 0], [40, 0, 10], { position: [60, 2, 50], roll: 0.2 }, [0, 0, 60]]} />
</Group>
<Mesh receiveShadow>
  <SplineMesh container={track} mesh={models.roadPiece} />   {/* a modelled section, repeated */}
</Mesh>
<Group>
  <SplineInstantiate container={track} itemsToInstantiate={[Lamp]} spacing={20} positionOffset={[9, 0, 0]} />
</Group>
<Group>
  <SplineAnimate container={track} animationMethod="speed" maxSpeed={20} />
  <Car />
</Group>
```

- `SplineContainer` — `knots`, `closed`; `evaluatePosition/Tangent/UpVector(t)` in world space and
  `calculateLength()`. `t` runs 0..1 along the length. A knot is a position, its tangents smoothed
  from its neighbours, or `{ position, tangentIn, tangentOut, roll }`; `roll` banks the turn.
- `SplineMesh` — bends a modelled piece (a road section with its kerbs, a rail, a fence) along the
  spline, repeated end to end; a `Model` keeps its materials. The piece runs along +Z with +Y up and
  bends where it has edge loops. Compressed glTF (gltfpack `-cc`) is fine.
- `SplineExtrude` — a round or square tube: a pipe, a cable. `radius`, `sides`, `segmentsPerUnit`,
  `capped`, `range`.
- `SplineInstantiate` — prefabs along the spline by `spacing` or `instanceCount`, with
  `positionOffset`, `rotationOffset`, `alignTo`.
- `SplineAnimate` — moves its node along the spline by `duration` or `maxSpeed`; `loop` is `once`,
  `loopContinuous` or `pingPong`; `play()`, `pause()`, `restart()`, a `completed` event.
- `Spline` and `SplineUtility.getNearestPoint` — the curve itself, in its container's space: where
  a car is on the track, how far it is from the centre line.

The components find their spline through `container={ref}`, a ref to the node holding the
`SplineContainer`, or use the one on their own node. `SplineMesh`, `SplineExtrude` and
`SplineInstantiate` build once in `start`; call `rebuild()` after changing the knots.
