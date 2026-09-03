import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Imports have to match the *tracked* filename exactly, including its case.
 *
 * macOS and Windows do not care; Linux does, and CI runs on Linux. A file renamed only in its
 * capitalisation is invisible to git on a case-insensitive filesystem, so the working tree can
 * say `CameraFit.ts` while the repository still says `cameraFit.ts` — and every check passes
 * locally while a clean Linux checkout cannot resolve the import at all.
 *
 * That happened. This is the check that would have caught it before the push.
 */
describe('filenames', () => {
  // Only git knows the recorded case, so outside a checkout — an export, a published tarball —
  // there is nothing to check rather than something failing.
  const tracked = trackedFiles();

  it('are imported with the case the repository records', () => {
    const byLower = new Map(tracked.map((path) => [path.toLowerCase(), path]));
    const wrong: string[] = [];

    for (const file of tracked) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      // The import text comes from the working tree; the filename it must match comes from git.
      const source = readFileSync(join(ROOT, file), 'utf8');
      const directory = file.slice(0, file.lastIndexOf('/'));
      for (const match of source.matchAll(/from '(\.[^']+\.js)'/g)) {
        const specifier = match[1]!;
        const resolved = normalise(`${directory}/${specifier.slice(0, -3)}.ts`);
        const actual = byLower.get(resolved.toLowerCase());
        if (actual && actual !== resolved) wrong.push(`${file}: imports ${specifier}, repo has ${actual}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('never differ from another tracked path by case alone', () => {
    // Two such files cannot both exist in a checkout on macOS or Windows, so one of them is
    // silently missing there — the mirror image of the bug above.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const file of tracked) {
      const previous = seen.get(file.toLowerCase());
      if (previous) collisions.push(`${previous} vs ${file}`);
      else seen.set(file.toLowerCase(), file);
    }
    expect(collisions).toEqual([]);
  });
});

/** Every file the repository records, or none when this is not a checkout. */
function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Collapse `a/b/../c` to `a/c`, so a relative import compares against a repository path. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
