# Castle

An empty field, lit, with a camera looking at the middle of it. The primitives, four materials, no
components, no scripts. It exists to be **filled in** — by a person, or by a model with the
editor's eyes.

```bash
npm --prefix examples/castle run dev
```

The shapes are ordinary assets, written by `scenoco new asset` and sized as Unity
sizes them. A mesh names one, and `scale` says how big this one is:

```xml
<Mesh geometry="../geometry/cube.asset.xml" material="../materials/stone.asset.xml"
      position="y: 2" scale="x: 24; y: 4; z: 1" />
```

| | |
| --- | --- |
| `cube` | 1 × 1 × 1 |
| `sphere` | 1 across |
| `cylinder` `capsule` | 1 across, **2 tall** |
| `cone` | 1 across, 1 tall |
| `quad` | 1 × 1, upright |
| `plane` | 10 × 10, upright — lay it flat with `eulerAngles="x: -90"` |

An empty stage: the shapes above, a light and a camera, and nothing built. The two sizes in bold
are the ones that get built wrong every time.
