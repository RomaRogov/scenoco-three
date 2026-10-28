import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { prefab } from '@scenoco-three/core';
import { Fade } from '../Fade';

/** A prefab: `prefab()` around a function returning TSX. `instantiate(Crate)` builds a fresh one each call. */
export const Crate = prefab(() => (
  <Mesh scale={0.5} castShadow>
    <BoxGeometry />
    <MeshStandardMaterial color="#facc15" />
    <Fade seconds={3} />
  </Mesh>
));
