import { AmbientLight, DirectionalLight, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { ref } from '@scenoco-three/core';
import { BoxCollider, MeshCollider, Rigidbody, TerrainCollider } from '@scenoco-three/rapier';
import { Terrain } from '@scenoco-three/terrain';
import { materials, models, textures } from '../assets';
import { EggController } from '../EggController';
import { slope, unity } from '../layout';
import { LevelController } from '../LevelController';
import { Nest } from '../markers';
import { ModelView } from '../ModelView';
import { MusicController } from '../MusicController';
import { TerrainMesh } from '../TerrainMesh';
import { UIController } from '../UIController';
import { EggBottom, EggTop, Fried, Star, Stone1, Stone2, Stone3 } from './prefabs';

/** The Unity game's Main scene: the slope, the egg, the camera that follows it, the sound and the UI. */
export const Main = () => {
  const cam = ref<Group>();
  const ground = ref<Group>();
  const floor = ref<Mesh>();
  const nest = ref<Group>();
  return (
    <Scene>
      {/* Unity's lighting, in its own amounts: flat white ambient at 1, the sun at 1 — three.js's
          physical units are π times Unity's — and Unity's Standard shader in gamma space keeps 0.78 of
          the light for diffuse (its dielectric reflects 0.22). Shadow strength 0.848. */}
      <AmbientLight intensity={Math.PI * 0.78} />

      <Group name="camContainer" ref={cam} position={unity.camContainer}>
        <PerspectiveCamera position={unity.camera} quaternion={unity.cameraRotation} fov={60} near={0.3} far={1000} />
        {/* Unity's sun, kept over the egg so its shadows stay sharp along a long slope. Shadows reach
            40 m around it, as far as the Unity project's High quality cast them. */}
        <DirectionalLight intensity={Math.PI * 0.78} position={unity.sunPosition} castShadow shadow-intensity={0.848} shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-far={120} shadow-bias={-0.0005} />
      </Group>

      <Group name="terrain">
        <TerrainMesh startTex={textures.start} endTex={textures.end} terrainData={slope} ground={ground} floor={floor} />
        <Group name="ground" ref={ground}>
          <Terrain terrainData={slope} castShadows={true} />
          <TerrainCollider terrainData={slope} friction={0.6} />
        </Group>
        <Group name="level">
          <LevelController nest={nest} stones={[Stone1, Stone2, Stone3]} star={Star} />
          <Group name="nest" ref={nest} quaternion={unity.nestRotation}>
            <Nest />
            <ModelView model={models.nest} materials={{ basket: materials.nest, leaf1: materials.leaves, leaf2: materials.leaves }} />
            <BoxCollider size={[4.85, 2.41, 3.17]} isTrigger />
          </Group>
        </Group>
      </Group>

      <Mesh name="floor" ref={floor} rotation={[-Math.PI / 2, 0, 0]} material={materials.floor} receiveShadow>
        <PlaneGeometry args={[40, 40]} />
        <BoxCollider size={[40, 40, 0.2]} center={[0, 0, -0.1]} />
      </Mesh>

      <Group name="egg" position={unity.egg}>
        <ModelView model={models.egg} material={materials.egg} />
        <Rigidbody isKinematic />
        {/* Unity's egg weighs a kilogram: its hull is about 0.47 m³. Its physic material grips at 1 moving, 0.6 at
            rest; Rapier's single friction needs more to grip as PhysX's contact patches do. At 2.4 a held push gets
            over the start bump as soon as it did in Unity, and lands no harder. */}
        <MeshCollider convex density={2.15} friction={2.4} />
        <EggController camContainer={cam} topPart={EggTop} bottomPart={EggBottom} fried={Fried} />
      </Group>

      <Group name="music">
        <MusicController />
      </Group>
      <Group name="ui">
        <UIController />
      </Group>
    </Scene>
  );
};
