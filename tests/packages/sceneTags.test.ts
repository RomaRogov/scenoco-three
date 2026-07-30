import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanComponents } from '@scenoco-three/compiler';

/**
 * `export const sceneTags` is the authoritative tag list for a package: when a
 * project registers a tag package, `registerPackages` trusts `sceneTags` *instead
 * of* diffing the registry (it works even if the module was already imported). A
 * stale list therefore drops tags silently from the XSD, `scene-api.json` and its
 * `source` links — no error, just missing entries. This is the guard, mirroring
 * the `builtinNodeModules` check in tooling/plugin.test.ts.
 *
 * Both sides are read statically: `sceneTags` from the source literal, the truth
 * from `scanComponents`. Importing the packages instead would be impossible in one
 * process — `collision` and `rapier` register the same tags on purpose (asserted
 * below), so importing both throws a duplicate-registration error.
 */
const PACKAGES = ['animation', 'audio', 'box2d', 'collision', 'particles', 'rapier', 'ui'];

/** The string literals in a package's `export const sceneTags = [...]`. */
function declaredTags(pkg: string): string[] {
  const src = readFileSync(`packages/${pkg}/src/index.ts`, 'utf8');
  const list = /export const sceneTags = \[(.*?)\]/s.exec(src);
  if (!list) throw new Error(`packages/${pkg}/src/index.ts has no sceneTags export`);
  return [...list[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
}

/** Every component/node/attachment tag the package's sources actually declare. */
function registeredTags(pkg: string): string[] {
  const scan = scanComponents([`packages/${pkg}/src`], process.cwd());
  return [...new Set([...scan.byName.keys(), ...scan.byTag.keys()])].sort();
}

describe('package sceneTags manifests', () => {
  it.each(PACKAGES)('%s: sceneTags matches the tags the package declares', (pkg) => {
    expect(declaredTags(pkg)).toEqual(registeredTags(pkg));
  });

  it('collision and rapier deliberately claim the same tags, so they are mutually exclusive', () => {
    // Both are 3D physics backends exposing one authoring surface (<RigidBody>,
    // <BoxCollider>, …). A project picks one; installing both throws a duplicate
    // registration error at import. Documented in each package's README.
    const shared = declaredTags('collision').filter((t) => declaredTags('rapier').includes(t));
    expect(shared).toEqual(['BoxCollider', 'CapsuleCollider', 'CylinderCollider', 'Physics', 'PlaneCollider', 'RigidBody', 'SphereCollider']);
  });
});
