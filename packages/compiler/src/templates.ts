import { ASSET_KINDS, type AssetKind } from './assets.js';

/**
 * What `scenoco new <kind> <name>` writes.
 *
 * Each one is a **complete document that compiles**, and where it can, one that does something
 * visible: a fresh `.particle.xml` that emits nothing looks broken, while one that fires a small
 * burst tells you the pipeline works and gives you numbers to change. That matters most for
 * whoever reads a starter to learn the format, which is the common case here.
 *
 * The rule the starters follow is that one must never reference a file it cannot expect to be
 * there. A prefab is a bare `<Group>` rather than a mesh, because a mesh needs a geometry and a
 * material that a fresh project has not got — a starter the compiler then rejects teaches the
 * format wrong, and it is the first thing anyone runs. The two exceptions name what their own
 * name implies: a `.texture.xml` for `brick` expects `brick.png` beside it.
 */
const TEMPLATES: Record<AssetKind['kind'], (name: string, tag?: string) => string> = {
  texture: (name) => `<!-- ${name}: an image plus how to sample it. Point a material at this file
     instead of at the image when the settings matter. -->
<Texture src="${name}.png" colorSpace="SRGBColorSpace" />
`,

  // With no tag named: a primitive's own numbers if the name is one, a material otherwise.
  asset: (name, tag) => {
    if (!tag) return PRIMITIVES[name] ?? TEMPLATES.asset(name, 'MeshStandardMaterial');
    if (tag === 'MeshStandardMaterial') {
      return `<!-- ${name}: a shared material. Every mesh that names it shares one —
     <Mesh material="../${name}.asset.xml" />. Write the element inside a <Mesh> instead to give
     that one mesh its own. -->
<MeshStandardMaterial color="#e9c46a" roughness="0.5" metalness="0.1" />
`;
    }
    return `<!-- ${name}: a shared ${tag}. Name this file from the attribute that takes one —
     geometry="…", material="…" — and every node that names it shares one. -->
<${tag} />
`;
  },

  particle: (name) => `<!-- ${name}: a short one-shot burst. Play it with
     <ParticleSystem effect="../vfx/${name}.particle.xml" />. -->
<ParticleSystem duration="1" looping="false" simulationSpace="World"
                startLifetime="0.8" startSpeed="2" startSize="0.15" startColor="#ffdd66">
  <Emission rateOverTime="0">
    <Burst time="0" count="24" />
  </Emission>
  <Shape type="Sphere" radius="0.2" />
  <ColorOverLifetime colors="[#ffee88, #ff6622]" />
  <SizeOverLifetime curve="[1, 0.6, 0]" />
</ParticleSystem>
`,

  render: (name) => `<!-- ${name}: how a scene is drawn. Point a scene at it with
     <Scene render="../render/${name}.render.xml">, and every scene that names it shares one look.

     Each child is one thing that decides how the frame looks — it is on because the element is
     here, so there is no value that means "off": delete the line instead. <Fog> is three.js's
     own; add @scenoco-three/postfx for <ToneMapping>, <Shadows>, <Bloom> and <Vignette>. -->
<Render>
  <Fog color="#0a0a12" near="10" far="60" />
</Render>
`,

  prefab: (name) => `<!-- ${name}: the root element IS the node this prefab produces — there is no
     wrapper, so this compiles to \`class ${pascal(name)} extends Group\`. Spawn it with
     <Prefab src="${name}.prefab.xml" /> or instantiate(${pascal(name)}).

     Swap <Group> for a <Mesh> once you have a shape for it, and a spawned ${name} *is* that
     mesh. Its geometry and material are either files it names — geometry="../x.asset.xml" —
     or elements written inside it, which give this prefab its own. -->
<Group />
`,

  scene: (name) => `<!-- ${name}: load it with SceneManager.load(${pascal(name)}Scene). -->
<Scene>
  <PerspectiveCamera id="camera" fov="50" near="0.1" far="200" position="y: 2; z: 8" />
  <AmbientLight intensity="0.6" />
  <DirectionalLight intensity="1.2" position="x: 3; y: 5; z: 2" />
</Scene>
`,
};

/**
 * The primitives, sized as Unity sizes them.
 *
 * Unity's built-in meshes are in the engine; here they are ordinary assets, because that is what
 * a shape is in this framework — there is no `<Cube>` tag and there should not be one, since a
 * node tag is a three.js class and three.js has no `Cube`. What these are is the *numbers*: a
 * cube one unit on a side, a sphere one across, so a mesh that names one is sized with `scale`
 * and nothing has to be worked out.
 *
 * `scenoco new asset` writes the lot; `scenoco new asset cube` writes one.
 *
 * A `<PlaneGeometry>` stands upright in XY, as three.js builds it. Unity's plane is pre-rotated
 * and ours is not — laying it flat is `eulerAngles="x: -90"` on the mesh, which is one attribute
 * and is the truth rather than a rotation hidden inside the asset.
 */
export const PRIMITIVES: Readonly<Record<string, string>> = {
  cube: `<!-- A cube, 1 x 1 x 1. Scale the mesh to size it:
     <Mesh geometry="../geometry/cube.asset.xml" material="…" scale="x: 8; y: 4; z: 1" /> -->
<BoxGeometry width="1" height="1" depth="1" />
`,
  sphere: `<!-- A sphere 1 across — radius 0.5, as Unity's is. -->
<SphereGeometry radius="0.5" widthSegments="32" heightSegments="16" />
`,
  cylinder: `<!-- A cylinder 1 across and 2 tall, as Unity's is, standing on Y.
     Two tall: scale="y: 3" makes it 6 tall, not 3. -->
<CylinderGeometry radiusTop="0.5" radiusBottom="0.5" height="2" radialSegments="32" />
`,
  capsule: `<!-- A capsule 1 across and 2 tall overall, as Unity's is: a 1-tall barrel with a
     hemisphere on each end. -->
<CapsuleGeometry radius="0.5" height="1" capSegments="8" radialSegments="16" />
`,
  cone: `<!-- A cone 1 across and 1 tall, point up. -->
<ConeGeometry radius="0.5" height="1" radialSegments="32" />
`,
  quad: `<!-- A 1 x 1 sheet, standing upright in XY and facing +Z, as three.js builds it.
     Lay it flat with eulerAngles="x: -90" on the mesh. -->
<PlaneGeometry width="1" height="1" />
`,
  plane: `<!-- A 10 x 10 sheet — Unity's plane size — standing upright in XY.
     A ground is this one laid flat:
     <Mesh geometry="../geometry/plane.asset.xml" material="…" eulerAngles="x: -90" scale="6" /> -->
<PlaneGeometry width="10" height="10" />
`,
};

/** The starter document for a kind, and the file name to write it to. */
export function templateFor(
  kind: AssetKind['kind'],
  name: string,
  tag?: string,
): { path: string; contents: string } {
  const asset = ASSET_KINDS.find((k) => k.kind === kind)!;
  return { path: `${asset.dir}/${name}${asset.extension}`, contents: TEMPLATES[kind](name, tag) };
}

/** `brick-wall` → `BrickWall` — the class name a scene or prefab document produces. */
function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
