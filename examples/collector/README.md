# Collector

Walk with a thumb stick, sweep up crates, run them to the pad in the middle. Thirty seconds, ten
deliveries to win — the shape of an RPG-flavoured playable.

<img src="screenshot.png" alt="Collector: crates scattered around a green depot pad, the player capsule beside one" width="360">

```bash
npm --prefix examples/collector run dev
```

| | |
| --- | --- |
| `src/Joystick.ts` | a floating touch stick: press anywhere, drag to steer |
| `src/Mover.ts` | walks where the stick says, turns to face it |
| `src/Carrier.ts` | the stack on your back |
| `src/Pickup.ts` | a crate; walk over it and it joins the stack |
| `src/Depot.ts` | the drop-off; walk in carrying anything and it all counts |
| `src/Scatter.ts` | lays crates out and keeps the level topped up |
| `src/Run.ts` | the clock, the quota, the two endings |

## The decisions worth copying

- **The joystick is two `<Panel>`s, moved every frame.** A UI element is a class and its
  attributes are its properties, so moving one is assigning to it — `base.x = 130`. `radius` at
  half the width is what makes a panel a circle.
- **Pixels the whole way through.** `Input.mousePosition` is already in the canvas's pixels, which
  is also what a panel's `x` and `y` are and what a thumb is measured in. Nothing in the joystick
  knows the camera exists.
- **`reach` is one number for the feel and the drawing.** Seventy pixels of drag is full speed and
  the ring is a hundred and forty across, so the knob touching the rim means exactly that. Two
  numbers would drift apart.
- **A picked-up crate is reparented, not copied.** `attach` keeps it where it is on screen while
  changing whose child it is, so it eases up onto the stack instead of teleporting. It stays an
  ordinary node the whole time, which is what lets the depot simply destroy it.
- **Sensors and the detection-only back-end.** Pickups and the depot need to know they were
  touched; nothing needs to bounce. `@scenoco-three/collision` is the whole physics bill.

## Traps this hit

Each compiled, typechecked, and was wrong.

- **A prefab's own placement used to beat the caller's.** `instantiate(crate, { position })` put
  every crate at the prefab's authored spot — fourteen crates in one pile at the origin. That was a
  real ordering bug in `instantiate` and is **fixed**: settings still apply before `onLoad`, so a
  prefab can build itself out of them, and placement now applies after, so the caller wins the way
  Unity's `Instantiate(prefab, position, rotation)` does. Pinned by a test in `tests/core`.
- **Placement replaces all three axes.** `Scatter` therefore names the resting `height` itself.
  Passing only x and z buries every crate at y = 0, and the player's collider then misses them by
  five centimetres.
- **A sphere collider takes the largest scale.** The depot is a disc — `scale="x: 3; y: 0.05; z: 3"`
  — and its collider is a 1.65 sphere, not a 0.0275 one. Convenient here, surprising elsewhere.
