// The packages whose tags this project's documents use.
//
// Tags are only ever written in XML, so nothing else here would import them — and a package is
// read through a real import, not through package.json. Without this file a fresh project has no
// vocabulary at all, because the .gen.ts files that would otherwise import three do not exist
// until the first build.
//
// Add a line per tag package you install: '@scenoco-three/ui', '@scenoco-three/box2d', and so on.
import 'three';
