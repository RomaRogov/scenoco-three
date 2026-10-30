import { BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { UIDocument, ref } from '@scenoco-three/core';
import { Dropper } from '../Dropper';
import { Follow } from '../Follow';
import { Mover } from '../Mover';

export const Main = () => {
  const player = ref<Mesh>();
  return (
    <Scene>
      <Color attach="background" args={['#10131c']} />
      <HemisphereLight args={['#ffffff', '#334455', 1]} />
      <DirectionalLight position={[3, 8, 5]} intensity={2} castShadow />
      <UIDocument referenceResolution={[1280, 720]} />

      <PerspectiveCamera position={[0, 6, 8]}>
        <Follow target={player} offset={[0, 6, 8]} />
      </PerspectiveCamera>

      <Mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <PlaneGeometry args={[30, 30]} />
        <MeshStandardMaterial color="#2a3142" />
      </Mesh>

      <Mesh ref={player} position={[0, 0.5, 0]} castShadow>
        <BoxGeometry />
        <MeshStandardMaterial color="#f97316" />
        <Mover speed={5} />
        <Dropper />
      </Mesh>
    </Scene>
  );
};
