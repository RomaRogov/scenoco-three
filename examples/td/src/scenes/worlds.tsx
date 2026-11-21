import { Group, Mesh, PlaneGeometry } from 'three';
import { prefab, ref } from '@scenoco-three/core';
import { SplineContainer, SplineInstantiate } from '@scenoco-three/splines';
import { models, paint, terrains } from '../assets';
import { LEVELS } from '../levels';
import { River } from '../River';
import { Scatter } from '../Scatter';
import { Terrain } from '@scenoco-three/terrain';
import { Bridge, Keep, Lair, Lantern, Pad } from './prefabs';

// The three maps. Terrain, path and pads come from the asset lab: `lab terrain levels/td-*.json`
// carved the road along these same knots, and tools/layout.py placed the pads beside it. The map
// is 256 m a side, and its ground carries on 128 m past every edge so no view finds where it ends;
// its node scales it to game units (a quarter), so the knots stay in metres.

// A prefab: the menu shows this map behind its cards, and the first level plays on it — one world, placed in both.
export const MeadowWorld = prefab(() => {
  const path = ref<Group>();
  return (
    <Group name="meadow">
      <Group name="terrain" scale={0.25}>
        <Terrain terrainData={terrains.meadow} castShadows={false} sideProjection={true} tileScale={1.5} />
      </Group>
      <Group name="path" ref={path} scale={0.25}>
        <SplineContainer knots={LEVELS.meadow.path} />
      </Group>
      <Mesh name="water" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={paint.water}>
        <PlaneGeometry args={[128, 128]} />
      </Mesh>
      <Lair position={[-0.25, 0.969, -32.17]} rotation={[0, -0.762, 0]} />
      <Keep position={[0, 0.891, 28.205]} rotation={[0, 3.142, 0]} />
      <Group name="lanterns">
        <SplineInstantiate container={path} itemsToInstantiate={[Lantern]} spacing={11} positionOffset={[1.8, 0, 0]} alignTo="world" />
      </Group>
      <Group name="scenery">
        <Scatter items={[models.tree]} count={60} seed={3} height={2.2} />
        <Scatter items={[models.rock]} count={30} seed={4} height={0.7} />
      </Group>
      <Pad position={[-1.06, 1.077, -26.49]} />
      <Pad position={[-7.92, 1.177, -29.00]} />
      <Pad position={[-5.34, 1.093, -20.65]} />
      <Pad position={[-12.67, 1.465, -20.76]} />
      <Pad position={[-11.89, 1.161, -12.48]} />
      <Pad position={[-3.45, 1.054, -14.90]} />
      <Pad position={[-3.07, 1.019, -7.67]} />
      <Pad position={[4.31, 1.017, -11.84]} />
      <Pad position={[4.23, 1.013, -4.59]} />
      <Pad position={[10.38, 1.064, -8.43]} />
      <Pad position={[12.89, 1.127, -0.72]} />
      <Pad position={[9.47, 0.872, 6.51]} />
      <Pad position={[5.332, 0.984, 1.985]} />
      <Pad position={[2.56, 1.006, 9.02]} />
      <Pad position={[-4.35, 1.048, 3.41]} />
      <Pad position={[-3.42, 1.061, 10.55]} />
      <Pad position={[-10.23, 1.131, 8.09]} />
      <Pad position={[-12.14, 1.247, 15.93]} />
      <Pad position={[-6.40, 1.127, 21.86]} />
      <Pad position={[-0.90, 1.046, 17.01]} />
      <Pad position={[3.88, 1.057, 24.24]} />
    </Group>
  );
});

export const CanyonWorld = () => {
  const path = ref<Group>();
  return (
    <Group name="canyon">
      <Group name="terrain" scale={0.25}>
        <Terrain terrainData={terrains.canyon} castShadows={false} sideProjection={true} tileScale={1.48} />
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
};

export const FrostWorld = () => {
  const path = ref<Group>();
  return (
    <Group name="frost">
      <Group name="terrain" scale={0.25}>
        <Terrain terrainData={terrains.frost} castShadows={false} sideProjection={true} tileScale={1.573} />
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
        <Scatter items={[models.pineSnow]} count={80} seed={7} height={2.4} />
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
