# @scenoco-three/editor

The **standalone editor** for [SceNoCo](https://github.com/RomaRogov/scenoco-three) scenes: a
static site with a tree, an inspector, transform gizmos and comment-preserving saves. It needs
nothing from a project and nothing from a server: it opens a scene from a folder on your machine
or from a URL, builds it live in the page, and writes your changes back into the XML.

It is what the repository publishes to GitHub Pages, and what `npx scenoco-editor` serves locally.

## Opening a scene

**A folder.** A scene is never one file — its geometry, materials and prefabs are files beside it
— so the editor opens a folder (Chrome and Edge, through the File System Access API), lists every
scene and prefab in it, and saves back to disk.

**A URL.** Any `.scene.xml` or `.prefab.xml` on the web; what it refers to is fetched relative to
it. Read-only, since the web is.

The examples the site carries are offered underneath either way.

## What it builds, and what it cannot

The page parses the document with the compiler's own parser (`@scenoco-three/compiler/browser`)
and builds the scene from the same vocabulary the compiler uses: three's classes and the tag
packages the site carries (collision, ui, postfx, audio, particles, box2d). Nodes, assets,
references, placement, prefabs and overrides are all live, stamped with the parser's positions,
so the tree, the inspector and the gizmos find every element.

It does not run anything, and has no Play. A component or a system is a project's own
TypeScript, and there is no TypeScript in a static page — so this is an editor of documents:
move things, arrange the hierarchy, set attributes, save. What it could not build it says rather
than drops. To see a scene *run*, an agent uses the observer, and a person runs the game.

## CLI

```bash
npx scenoco-editor            # serve the site locally and open it
npx scenoco-editor --port 5177 --no-open
```

## Building the site

```bash
npm run build:app             # static/public (the vocabulary, the examples) + dist-app/
npm run preview:app
```

## License

MIT
