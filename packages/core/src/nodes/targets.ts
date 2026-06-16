import { Line, Mesh, Points, Sprite } from 'three';

/** Nodes that accept a geometry attachment (mesh family + lines + points). */
export const GEOMETRY_TARGETS = [Mesh, Line, Points];

/** Nodes that accept a material attachment (geometry-bearing nodes + sprites). */
export const MATERIAL_TARGETS = [Mesh, Line, Points, Sprite];
