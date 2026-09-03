/**
 * Every class a document may name, for the standalone editor to construct from.
 *
 * three's exports, then the tag packages a page can carry. Rapier is not here: it is a
 * two-megabyte WebAssembly module, and a standalone viewer of documents has no physics to run.
 * A document that names its tags still opens; those nodes are inert, like every component.
 */
import * as THREE from 'three';
import '@scenoco-three/core';
import * as collision from '@scenoco-three/collision';
import * as ui from '@scenoco-three/ui';
import * as postfx from '@scenoco-three/postfx';
import * as audio from '@scenoco-three/audio';
import * as particles from '@scenoco-three/particles';
import * as box2d from '@scenoco-three/box2d';
import type { Registry } from '../live/build.js';

export const registry: Registry = { ...THREE, ...collision, ...ui, ...postfx, ...audio, ...particles, ...box2d };
