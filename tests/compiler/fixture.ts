import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const corePath = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
const serializePath = fileURLToPath(
  new URL('../../packages/compiler/src/serialize.ts', import.meta.url),
);
const threePath = fileURLToPath(new URL('../../node_modules/@types/three/index.d.ts', import.meta.url));
const box2dPath = fileURLToPath(new URL('../../packages/box2d/src/index.ts', import.meta.url));
const rapierPath = fileURLToPath(new URL('../../packages/rapier/src/index.ts', import.meta.url));
const collisionPath = fileURLToPath(new URL('../../packages/collision/src/index.ts', import.meta.url));
const particlesPath = fileURLToPath(new URL('../../packages/particles/src/index.ts', import.meta.url));
const audioPath = fileURLToPath(new URL('../../packages/audio/src/index.ts', import.meta.url));
const uiPath = fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url));
const uikitPath = fileURLToPath(new URL('../../node_modules/@pmndrs/uikit/dist/index.d.ts', import.meta.url));
// The particles package is mapped to its source, so its own dependency has to resolve too —
// otherwise `tsc` over a fixture project reports the package rather than the generated code.
const quarksPath = fileURLToPath(
  new URL('../../node_modules/three.quarks/dist/types/index.d.ts', import.meta.url),
);

/**
 * A real SceNoCo project on disk, for the scanner to read.
 *
 * Built as an actual project with an actual tsconfig rather than a string fixture: the whole
 * point of the scanner is that it runs the real TypeScript checker over real declarations, and
 * a synthetic program would be testing something else.
 */
export interface Fixture {
  dir: string;
  tsconfig: string;
  /** Write a `.ts` file under `src/`, creating directories as needed. */
  write(relativePath: string, source: string): void;
  /** Write a file at a path relative to the project root — an XML document, say. */
  writeXml(relativePath: string, source: string): void;
  /** Delete one, so a test that adds a deliberately broken document can take it back out. */
  remove(relativePath: string): void;
  dispose(): void;
}

/** Extra packages the fixture project should be able to resolve. */
export interface FixtureOptions {
  /** Map `@scenoco-three/box2d` to the workspace package, as a real project's install would. */
  box2d?: boolean;
  /** The 3D back-end. */
  rapier?: boolean;
  /** The detection-only back-end, which shares rapier's tag names on purpose. */
  collision?: boolean;
  /** The VFX package, which is also where `ParticleEffect` — a `.particle.xml`'s type — lives. */
  particles?: boolean;
  /** The audio package, which declares `AudioClip` — what a `clip="…"` reference resolves to. */
  audio?: boolean;
  /** The UI package: `<Canvas>`, `<Panel>`, `<Text>`, `<Image>`. */
  ui?: boolean;
  /** What the project declares about *itself*, in its own `package.json` — a preview, say. */
  scenoco?: Record<string, unknown>;
}

/** Where each optional package lives in this repository, by its npm name. */
const PACKAGES: Record<Exclude<keyof FixtureOptions, 'scenoco'>, string> = {
  box2d: box2dPath,
  rapier: rapierPath,
  collision: collisionPath,
  particles: particlesPath,
  audio: audioPath,
  ui: uiPath,
};

export function makeFixture(name: string, options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `scenoco-${name}-`));
  mkdirSync(join(dir, 'src'), { recursive: true });
  const tsconfig = join(dir, 'tsconfig.json');

  // A real install, because a package now *declares* things — its document kinds, the files it
  // loads, its prose — in its own `package.json`, and the toolchain reads that off disk. Linking
  // the workspace package rather than writing a stand-in manifest means these tests read what
  // ships: a package that renames a field or drops a starter goes red here.
  const enabled = (Object.keys(PACKAGES) as Array<keyof typeof PACKAGES>).filter((key) => options[key]);
  mkdirSync(join(dir, 'node_modules', '@scenoco-three'), { recursive: true });
  for (const key of [...enabled, 'core' as const]) {
    const source = key === 'core' ? corePath : PACKAGES[key];
    symlinkSync(join(source, '..', '..'), join(dir, 'node_modules', '@scenoco-three', key), 'dir');
  }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `scenoco-fixture-${name}`,
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(
        ['core', ...enabled].map((key) => [`@scenoco-three/${key}`, '*']),
      ),
      ...(options.scenoco ? { scenoco: options.scenoco } : {}),
    }),
  );

  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'ESNext.Decorators'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        experimentalDecorators: false,
        useDefineForClassFields: true,
        noEmit: true,
        skipLibCheck: true,
        // `three` has to resolve, or every inferred type quietly degrades to `any` —
        // `origin = new Vector3(...)` reads as `any` while an explicit `bricks: Mesh[]` still
        // prints, so a half-configured project looks like it worked.
        paths: {
          '@scenoco-three/core': [corePath],
          '@scenoco-three/compiler/serialize': [serializePath],
          three: [threePath],
          ...(options.box2d ? { '@scenoco-three/box2d': [box2dPath] } : {}),
          ...(options.rapier ? { '@scenoco-three/rapier': [rapierPath] } : {}),
          ...(options.collision ? { '@scenoco-three/collision': [collisionPath] } : {}),
          ...(options.particles
            ? { '@scenoco-three/particles': [particlesPath], 'three.quarks': [quarksPath] }
            : {}),
          ...(options.audio ? { '@scenoco-three/audio': [audioPath] } : {}),
          ...(options.ui ? { '@scenoco-three/ui': [uiPath] } : {}),
          '@pmndrs/uikit': [uikitPath],
        },
      },
      include: ['src', 'assets'],
    }),
  );

  return {
    dir,
    tsconfig,
    write(relativePath, source) {
      const full = join(dir, 'src', relativePath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source);
    },
    writeXml(relativePath, source) {
      const full = join(dir, relativePath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source);
    },
    remove(relativePath) {
      rmSync(join(dir, relativePath), { force: true });
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
