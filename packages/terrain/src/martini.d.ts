// @mapbox/martini ships no types: the part of its API this package uses.
declare module '@mapbox/martini' {
  export interface MartiniTile {
    /** Per sample: the error of leaving it out — kept by a mesh whose maxError is below it. */
    errors: Float32Array;
    /** Martini's pass over the triangles: each one's error, the larger of its own and its children's. */
    update(): void;
    getMesh(maxError?: number): { vertices: Uint16Array; triangles: Uint32Array };
  }
  export default class Martini {
    constructor(gridSize?: number);
    createTile(terrain: Float32Array): MartiniTile;
  }
}
