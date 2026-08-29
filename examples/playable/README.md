# Playable

One mechanic, twenty seconds, no menu — the shape of a playable ad. Tap the falling blocks:
twelve wins, five misses loses.

```bash
npm --prefix examples/playable run dev
```

It exists to be **copied**. Everything specific to this game is in `src/`, and everything that
would be specific to *any* tap-and-drop playable is in the same place, so the next one starts by
changing `Round`'s numbers and swapping the prefab.

| | |
| --- | --- |
| `src/Round.ts` | the whole of the rules: a clock, a score, and the two ways it ends |
| `src/Pointer.ts` | turns a tap into `onTap` on whatever is under it |
| `src/taps.ts` | the `onTap` hook, merged onto `Component` so it is typed |
| `src/Spawner.ts` | drops a prefab at intervals, tightening as the clock runs down |
| `src/Faller.ts` | falls; a miss if it reaches the floor |
| `src/Target.ts` | spins, and pops when tapped |
| `src/Hud.ts` | reads the round and writes the readout |

## What it is doing that is worth copying

- **Portrait first.** `<CameraFit mode="contain" width="9" height="16">` keeps the same play area
  on any screen, so a phone and a landscape slot both frame the whole thing.
- **The spawner names its prefab.** `spawns="target.prefab.xml"` fills a `PrefabType` field. That
  is what keeps repetition in a component instead of thirty near-identical elements.
- **No physics package.** A constant-velocity drop is the whole simulation, and an ad wants to
  load in a couple of hundred kilobytes. Reach for `@scenoco-three/box2d` when the mechanic needs
  contacts.
- **The tap hook is typed.** `onTap` comes from an interface merged onto `Component` — the same
  way `@scenoco-three/collision` declares `onCollisionEnter` — so a misspelling is a compile
  error rather than a handler that never fires.

## Three traps this hit, which are worth knowing

Each of these compiled, typechecked, and was wrong.

- **`eulerAngles` does not write through.** It is a degrees *view*, refreshed from `rotation` on
  every read, so `node.eulerAngles.y += x` sets a field the next read discards. Assign the whole
  vector, or turn `rotation` (radians) — which is what `Target` does.
- **Local is not world.** `Faller` compares against a world floor, so it reads a world position.
  Spawned targets are children of a spawner nine units up; comparing their *local* y landed them
  near the top of the screen and lost the round in eight seconds. It looked like difficulty.
- **A screen-space HUD is in front of everything.** `<Canvas>` is parented to the camera, so the
  nearest raycast hit is almost always a UI panel. `Pointer` walks every intersection and stops
  at the first that wants the tap; taking hit zero means the game never receives one.
