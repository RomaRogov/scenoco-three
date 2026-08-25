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
const TEMPLATES: Record<AssetKind['kind'], (name: string) => string> = {
  texture: (name) => `<!-- ${name}: an image plus how to sample it. Point a material at this file
     instead of at the image when the settings matter. -->
<Texture src="${name}.png" colorSpace="SRGBColorSpace" />
`,

  geometry: (name) => `<!-- ${name}: a shared geometry. Reference it from a mesh with
     geometry="../geometry/${name}.geometry.xml" — every mesh that names it shares one. -->
<BoxGeometry width="1" height="1" depth="1" />
`,

  material: (name) => `<!-- ${name}: a shared material. Reference it from a mesh with
     material="../materials/${name}.material.xml". -->
<MeshStandardMaterial color="#e9c46a" roughness="0.5" metalness="0.1" />
`,

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

     Swap <Group> for <Mesh geometry="../geometry/x.geometry.xml"
     material="../materials/x.material.xml"> once you have those, and a spawned ${name}
     *is* that mesh. -->
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

/** The starter document for a kind, and the file name to write it to. */
export function templateFor(kind: AssetKind['kind'], name: string): { path: string; contents: string } {
  const asset = ASSET_KINDS.find((k) => k.kind === kind)!;
  return { path: `${asset.dir}/${name}${asset.extension}`, contents: TEMPLATES[kind](name) };
}

/** `brick-wall` → `BrickWall` — the class name a scene or prefab document produces. */
function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
