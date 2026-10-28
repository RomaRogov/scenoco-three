import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { CameraRig } from '../CameraRig';
import { LevelRules } from './Level';
import { MeadowWorld } from './worlds';

export const Meadow = () => (
  <Scene>
    <Color attach="background" args={['#a8dcf5']} />
    <Fog attach="fog" args={['#a8dcf5', 80, 160]} />
    <HemisphereLight args={['#fff4dc', '#56784a', 1.5]} />
    <DirectionalLight
      position={[16, 32, 12]} intensity={2.3} castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-far={90} shadow-bias={-0.0005}
    />
    <PerspectiveCamera fov={40}>
      <CameraRig ground={1} wideCentre={[-2.798, -2.072]} />
    </PerspectiveCamera>
    <MeadowWorld />
    <LevelRules level="meadow" />
  </Scene>
);
