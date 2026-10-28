import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { CameraRig } from '../CameraRig';
import { LevelRules } from './Level';
import { FrostWorld } from './worlds';

export const Frost = () => (
  <Scene>
    <Color attach="background" args={['#cfe6f7']} />
    <Fog attach="fog" args={['#cfe6f7', 75, 150]} />
    <HemisphereLight args={['#eef6ff', '#5a6a86', 1.55]} />
    <DirectionalLight
      position={[14, 30, 16]} intensity={2.1} color="#e8f2ff" castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-far={110} shadow-bias={-0.0005}
    />
    <PerspectiveCamera fov={40}>
      <CameraRig ground={7} wideCentre={[0, -1.216]} />
    </PerspectiveCamera>
    <FrostWorld />
    <LevelRules level="frost" />
  </Scene>
);
