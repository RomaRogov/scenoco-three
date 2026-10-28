# @scenoco-three/unity

A SceNoCo game's prefabs and scenes, written into a Unity project as Unity's own assets.

```bash
npx scenoco-unity path/to/UnityProject --root path/to/game
```

Unity builds them the next time it compiles (or from **SceNoCo ▸ Import**):

- **Prefabs** in `Assets/Prefabs/`, one per prefab a `.tsx` file exports. `<ArrowBase />` written with
  no attributes stays a nested prefab; a prefab given attributes is copied in.
- **Scenes** in `Assets/Scenes/`, listed in Build Settings with the one `main.ts` plays first: lights,
  camera, fog, background and ambient light.
- **Meshes** in `Assets/Meshes/`, from three.js's own geometry, so a cone or a torus is exactly the
  shape the web game draws. Two geometries with the same vertices are one mesh.
- **Materials** in `Assets/Materials/` (URP Lit or Unlit), shared exactly as three.js shares them: one
  made in `assets.ts` is one asset for every renderer that uses it, so Unity batches them; one written
  inside an element is that element's own, even if another looks the same.
- **Behaviours** as MonoBehaviours. A game behaviour gets a C# stub in `Assets/Scripts/` with the
  fields its elements write, already set on every prefab and scene; its logic is yours to port. The
  stub is written once and never overwritten. Rapier's and Box2D's components become Unity's own
  rigidbodies and colliders, and Box2D's joints Unity's 2D joints.

The game is read in its own page, through its own Vite dev server and a headless Chrome: every
module but the entry is imported, so nothing starts, and each prefab is built with its behaviours
dormant. What a behaviour builds at runtime is not exported — only what the TSX declares. Whatever
cannot be carried across is listed as a warning, with the file and line it was written at.

three.js is right-handed and Unity left-handed: the export mirrors Z, and divides light intensities
by π.
