import { Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene } from 'three';
import { ref, sharedModel } from '@scenoco-three/core';
import { SplineContainer, SplineInstantiate } from '@scenoco-three/splines';
import { Terrain, TerrainData } from '@scenoco-three/terrain';
import { CameraRig } from '../CameraRig';
import { layersOf, models } from '../assets';
import { LEVELS } from '../levels';
import { Scatter } from '../Scatter';
import { LevelRules } from './Level';
import { Look } from './Look';
import { Keep, Lair, Lantern, Pad } from './prefabs';
import frostTerrainUrl from '../levels/frost/frost.terrain?url';
import pineSnowUrl from '../models/pine_snow.glb?url';

/** This level's ground and its snowy pines: declared here, so they load with the level when it is chosen. */
const ground = new TerrainData(frostTerrainUrl, layersOf('frost'));
const pineSnow = sharedModel(pineSnowUrl);

export const FrostWorld = () => {
  const path = ref<Group>();
  return (
    <Group name="frost">
      <Group name="terrain" scale={0.25}>
        <Terrain terrainData={ground} castShadows={false} sideProjection={true} tileScale={1.573} />
      </Group>
      <Group name="path" ref={path} scale={0.25}>
        <SplineContainer knots={LEVELS.frost.path} />
      </Group>
      <Lair position={[9.889, 7.482, -31.219]} rotation={[0, 0.074, 0]} />
      <Keep position={[0.036, 3.345, 28.202]} rotation={[0, 3.318, 0]} />
      <Group name="lanterns">
        <SplineInstantiate container={path} itemsToInstantiate={[Lantern]} spacing={10} positionOffset={[1.8, 0, 0]} alignTo="world" />
      </Group>
      <Group name="scenery">
        <Scatter items={[pineSnow]} count={80} seed={7} height={2.4} />
        <Scatter items={[models.rock]} count={30} seed={8} height={0.8} />
      </Group>
      <Pad position={[6.74, 7.557, -27.50]} />
      <Pad position={[8.13, 7.691, -20.27]} />
      <Pad position={[1.63, 6.753, -19.42]} />
      <Pad position={[-1.076, 6.732, -25.886]} />
      <Pad position={[-5.54, 7.047, -18.99]} />
      <Pad position={[-11.35, 8.578, -10.87]} />
      <Pad position={[-4.49, 7.077, -9.17]} />
      <Pad position={[3.51, 7.297, -9.17]} />
      <Pad position={[10.445, 8.558, -13.393]} />
      <Pad position={[9.84, 9.259, -0.32]} />
      <Pad position={[3.16, 7.673, 0.95]} />
      <Pad position={[-5.779, 7.832, 2.825]} />
      <Pad position={[-9.55, 8.302, -3.96]} />
      <Pad position={[-12.02, 9.238, 8.53]} />
      <Pad position={[-4.80, 7.953, 11.19]} />
      <Pad position={[3.937, 7.813, 12.267]} />
      <Pad position={[7.85, 8.689, 6.03]} />
      <Pad position={[7.87, 5.933, 20.85]} />
      <Pad position={[-3.53, 5.656, 18.46]} />
      <Pad position={[1.70, 4.604, 22.61]} />
    </Group>
  );
};

export const Frost = () => (
  <Scene>
    <Color attach="background" args={['#cfe6f7']} />
    <Fog attach="fog" args={['#cfe6f7', 75, 150]} />
    <HemisphereLight args={['#eef6ff', '#5a6a86', 1.55]} />
    <DirectionalLight
      position={[14, 30, 16]} intensity={2.1} color="#e8f2ff" castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-near={1} shadow-camera-far={80}
      shadow-bias={-0.0001} shadow-normalBias={0.05}
    />
    <Look />
    <PerspectiveCamera fov={40}>
      <CameraRig ground={7} wideCentre={[0, -1.216]} />
    </PerspectiveCamera>
    <FrostWorld />
    <LevelRules level="frost" />
  </Scene>
);
