import { Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene } from 'three';
import { prefab, ref } from '@scenoco-three/core';
import { SplineContainer, SplineInstantiate } from '@scenoco-three/splines';
import { Terrain, TerrainData } from '@scenoco-three/terrain';
import { CameraRig } from '../CameraRig';
import { layersOf, models, paint } from '../assets';
import { LEVELS } from '../levels';
import { River } from '../River';
import { Scatter } from '../Scatter';
import { LevelRules } from './Level';
import { Look } from './Look';
import { Keep, Lair, Lantern, Pad, Bridge } from './prefabs';
import canyonTerrainUrl from '../levels/canyon/canyon.terrain?url';

/** This level's ground: declared here, so it loads with the level when it is chosen, not with the menu. */
const ground = new TerrainData(canyonTerrainUrl, layersOf('canyon'));

/** The canyon's map: ground and river, road and lanterns, scenery and pads — a prefab, as the meadow's is. */
export const CanyonWorld = prefab(() => {
  const path = ref<Group>();
  return (
    <Group name="canyon">
      <Group name="terrain" scale={0.25}>
        <Terrain terrainData={ground} castShadows={false} sideProjection={true} tileScale={1.48} />
        <Mesh name="river" material={paint.river} position={[0, -0.058, 0]}>
          <River knots={LEVELS.canyon.river!} level={1.22} bank={1.298} shore={0.399} depth={1.701} width={12.138} />
        </Mesh>
      </Group>
      <Group name="path" ref={path} scale={0.25}>
        <SplineContainer knots={LEVELS.canyon.path} />
      </Group>
      <Lair position={[-5.004, 1.854, -31.99]} rotation={[0, -0.316, 0]} />
      <Keep position={[-0.16, 1.756, 28.128]} rotation={[0, 2.246, 0]} />
      <Bridge position={[-5.356, 1.97, -0.586]} rotation={[0, -0.665, 0]} t={0.5319} scale={[0.938, 1.182, 1.32]} />
      <Group name="lanterns">
        <SplineInstantiate container={path} itemsToInstantiate={[Lantern]} spacing={11} positionOffset={[-1.8, 0, 0]} alignTo="world" />
      </Group>
      <Group name="scenery">
        <Scatter items={[models.pine, models.tree]} count={70} seed={5} height={2.2} />
        <Scatter items={[models.rock]} count={40} seed={6} height={0.8} />
      </Group>
      <Pad position={[-9.283, 2.923, -28.379]} />
      <Pad position={[-3.56, 2.114, -25.10]} />
      <Pad position={[-8.23, 2.71, -20.15]} />
      <Pad position={[-1.53, 1.985, -17.11]} />
      <Pad position={[2.63, 2.058, -23.19]} />
      <Pad position={[5.345, 2.456, -12.788]} />
      <Pad position={[8.98, 2.417, -5.14]} />
      <Pad position={[1.28, 2.005, -9.63]} />
      <Pad position={[9.563, 3.338, -20.225]} />
      <Pad position={[-7.517, 2.273, -4.998]} />
      <Pad position={[-3.736, 1.857, 3.364]} />
      <Pad position={[-12.459, 3.758, 4.615]} />
      <Pad position={[-5.82, 2.353, 7.67]} />
      <Pad position={[-8.65, 2.87, 15.31]} />
      <Pad position={[-1.96, 1.946, 17.19]} />
      <Pad position={[1.55, 1.861, 10.81]} />
      <Pad position={[8.51, 2.424, 14.11]} />
      <Pad position={[4.23, 2.089, 19.84]} />
      <Pad position={[11.532, 3.366, 20.952]} />
      <Pad position={[7.92, 2.567, 26.879]} />
    </Group>
  );
});

export const Canyon = () => (
  <Scene>
    <Color attach="background" args={['#f4d9a8']} />
    <Fog attach="fog" args={['#f4d9a8', 80, 170]} />
    <HemisphereLight args={['#ffe9c4', '#6a5a3a', 1.45]} />
    <DirectionalLight
      position={[-18, 30, 10]} intensity={2.5} color="#fff0d6" castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-near={1} shadow-camera-far={80}
      shadow-bias={-0.0001} shadow-normalBias={0.05}
    />
    <Look />
    <PerspectiveCamera fov={40}>
      <CameraRig ground={2} wideCentre={[0, -3.4]} span={69.621} />
    </PerspectiveCamera>
    <CanyonWorld />
    <LevelRules level="canyon" />
  </Scene>
);
