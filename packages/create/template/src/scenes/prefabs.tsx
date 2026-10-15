import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { Fade } from '../Fade';

/** A prefab is a function returning TSX; `instantiate(Crate)` builds a fresh one each call. */
export const Crate = () => (
  <Mesh scale={0.5} castShadow>
    <BoxGeometry />
    <MeshStandardMaterial color="#facc15" />
    <Fade seconds={3} />
  </Mesh>
);
