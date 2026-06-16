/**
 * Maps each built-in node tag to the package subpath that registers it, so the
 * build tooling (Vite plugin) can emit **usage-based imports** for built-ins —
 * exactly the way it does for project `@component` files. A scene that uses only
 * `<Mesh><BoxGeometry/>` ships `Mesh.js` + `BoxGeometry.js` (and just their three
 * classes), not the whole node set.
 *
 * The runtime entry (`@scenoco-three/core`) deliberately does NOT import these,
 * so `import { Engine } from '@scenoco-three/core'` pulls in zero node modules
 * and the bundler tree-shakes everything unused. `@scenoco-three/core/nodes`
 * (the barrel) registers them all, for Node tooling / tests / non-bundled use.
 *
 * Kept in sync with `nodes/index.ts` by `tests/treeshake.test.ts`, which fails
 * if a registered built-in is missing here (or vice versa).
 */
export const builtinNodeModules: Record<string, string> = {
  // object3d — structural
  Scene: '@scenoco-three/core/nodes/object3d/Scene.js',
  Object3D: '@scenoco-three/core/nodes/object3d/Object3D.js',
  Group: '@scenoco-three/core/nodes/object3d/Group.js',
  Bone: '@scenoco-three/core/nodes/object3d/Bone.js',
  LOD: '@scenoco-three/core/nodes/object3d/LOD.js',
  // object3d — renderables
  Mesh: '@scenoco-three/core/nodes/object3d/Mesh.js',
  InstancedMesh: '@scenoco-three/core/nodes/object3d/InstancedMesh.js',
  SkinnedMesh: '@scenoco-three/core/nodes/object3d/SkinnedMesh.js',
  BatchedMesh: '@scenoco-three/core/nodes/object3d/BatchedMesh.js',
  Line: '@scenoco-three/core/nodes/object3d/Line.js',
  LineLoop: '@scenoco-three/core/nodes/object3d/LineLoop.js',
  LineSegments: '@scenoco-three/core/nodes/object3d/LineSegments.js',
  Points: '@scenoco-three/core/nodes/object3d/Points.js',
  Sprite: '@scenoco-three/core/nodes/object3d/Sprite.js',
  // object3d — lights
  AmbientLight: '@scenoco-three/core/nodes/object3d/AmbientLight.js',
  DirectionalLight: '@scenoco-three/core/nodes/object3d/DirectionalLight.js',
  HemisphereLight: '@scenoco-three/core/nodes/object3d/HemisphereLight.js',
  PointLight: '@scenoco-three/core/nodes/object3d/PointLight.js',
  RectAreaLight: '@scenoco-three/core/nodes/object3d/RectAreaLight.js',
  SpotLight: '@scenoco-three/core/nodes/object3d/SpotLight.js',
  // object3d — cameras
  PerspectiveCamera: '@scenoco-three/core/nodes/object3d/PerspectiveCamera.js',
  OrthographicCamera: '@scenoco-three/core/nodes/object3d/OrthographicCamera.js',
  ArrayCamera: '@scenoco-three/core/nodes/object3d/ArrayCamera.js',
  // geometries
  BoxGeometry: '@scenoco-three/core/nodes/geometry/BoxGeometry.js',
  SphereGeometry: '@scenoco-three/core/nodes/geometry/SphereGeometry.js',
  CylinderGeometry: '@scenoco-three/core/nodes/geometry/CylinderGeometry.js',
  PlaneGeometry: '@scenoco-three/core/nodes/geometry/PlaneGeometry.js',
  TorusGeometry: '@scenoco-three/core/nodes/geometry/TorusGeometry.js',
  // materials
  MeshStandardMaterial: '@scenoco-three/core/nodes/material/MeshStandardMaterial.js',
  MeshBasicMaterial: '@scenoco-three/core/nodes/material/MeshBasicMaterial.js',
  LineBasicMaterial: '@scenoco-three/core/nodes/material/LineBasicMaterial.js',
  PointsMaterial: '@scenoco-three/core/nodes/material/PointsMaterial.js',
  SpriteMaterial: '@scenoco-three/core/nodes/material/SpriteMaterial.js',
  // settings
  Fog: '@scenoco-three/core/nodes/setting/Fog.js',
  FogExp2: '@scenoco-three/core/nodes/setting/FogExp2.js',
  Background: '@scenoco-three/core/nodes/setting/Background.js',
};

/** The package subpath that registers a built-in tag, or undefined if not a built-in. */
export function builtinNodeModule(tag: string): string | undefined {
  return builtinNodeModules[tag];
}
