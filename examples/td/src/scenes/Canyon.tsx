import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { CameraRig } from '../CameraRig';
import { LevelRules } from './Level';
import { CanyonWorld } from './worlds';

export const Canyon = () => (
  <Scene>
    <Color attach="background" args={['#f4d9a8']} />
    <Fog attach="fog" args={['#f4d9a8', 80, 170]} />
    <HemisphereLight args={['#ffe9c4', '#6a5a3a', 1.45]} />
    <DirectionalLight
      position={[-18, 30, 10]} intensity={2.5} color="#fff0d6" castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-far={100} shadow-bias={-0.0005}
    />
    <PerspectiveCamera fov={40}>
      <CameraRig ground={2} />
    </PerspectiveCamera>
    <CanyonWorld />
    <LevelRules level="canyon" />
  </Scene>
);
