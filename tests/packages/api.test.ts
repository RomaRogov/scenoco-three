import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as audio from '@scenoco-three/audio';
import * as box2d from '@scenoco-three/box2d';
import * as particles from '@scenoco-three/particles';
import * as postprocessing from '@scenoco-three/postprocessing';
import * as rapier from '@scenoco-three/rapier';
import * as splines from '@scenoco-three/splines';
import * as terrain from '@scenoco-three/terrain';

const packages = { audio, box2d, particles, postprocessing, rapier, splines, terrain };

describe("each package's API.md", () => {
  it.each(Object.entries(packages))('names every export of %s', (name, exports) => {
    const digest = readFileSync(new URL(`../../packages/${name}/API.md`, import.meta.url), 'utf8');
    expect(Object.keys(exports).filter((key) => !new RegExp(`\\b${key}\\b`).test(digest))).toEqual([]);
  });
});
