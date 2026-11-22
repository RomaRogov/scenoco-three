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
