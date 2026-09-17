import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_KINDS, type AssetKind, type BuiltinKind } from './assets.js';

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
const TEMPLATES: Record<BuiltinKind, (name: string, tag?: string) => string> = {
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

/**
 * The starter document for a kind, and the file name to write it to.
 *
 * A package's kind brings its own starter, as a file inside the package — the one place that can
 * say what a good first `.particle.xml` looks like is the package that defines what one is. It is
 * read at `scenoco new` time and `{{name}}` in it becomes the name being created, so a starter may
 * refer to the file it is writing.
 */
export function templateFor(
  kind: string,
  name: string,
  tag?: string,
  kinds: readonly AssetKind[] = BUILTIN_KINDS,
): { path: string; contents?: string; problem?: string } {
  const asset = kinds.find((k) => k.kind === kind);
  if (!asset) throw new Error(`[scenoco] internal: no document kind "${kind}".`);
  const path = `${asset.dir}/${name}${asset.extension}`;

  if (!asset.package) return { path, contents: TEMPLATES[asset.kind as BuiltinKind]!(name, tag) };
  // Nothing shipped: the smallest document of this kind that compiles is one empty element.
  if (!asset.template) return { path, contents: `<${asset.type} />\n` };

  try {
    const source = readFileSync(resolve(asset.package.dir, asset.template), 'utf8');
    return { path, contents: source.replaceAll('{{name}}', name).replaceAll('{{Name}}', pascal(name)) };
  } catch {
    return {
      path,
      problem:
        `"${asset.package.name}" declares a starter for ${kind} documents at ${asset.template}, ` +
        `which is not in the installed package. Reinstall it, or write the document by hand — ` +
        `a ${kind} document is one <${asset.type}> element.`,
    };
  }
}

/** `brick-wall` → `BrickWall` — the class name a scene or prefab document produces. */
function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
