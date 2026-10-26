import { sharedModel } from '@scenoco-three/core';
import roadUrl from './models/road.glb?url';

/** 8 m of road with its kerbs, markings and shoulders, modelled in Blender (blender/road_piece.py). */
export const roadPiece = sharedModel(roadUrl);
