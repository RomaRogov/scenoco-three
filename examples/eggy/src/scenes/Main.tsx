import { AmbientLight, DirectionalLight, Group, Mesh, Object3D, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { UIDocument, ref } from '@scenoco-three/core';
import { BoxCollider, MeshCollider, Rigidbody, TerrainCollider } from '@scenoco-three/rapier';
import { Terrain } from '@scenoco-three/terrain';
import { AudioSource } from '@scenoco-three/audio';
import { EggModel, NestModel, materials, sounds, textures } from '../assets';
import { EggController } from '../EggController';
import { FitWidth } from '../FitWidth';
import { slope } from '../layout';
import { LevelController } from '../LevelController';
import { Nest } from '../markers';
import { ModelMaterials } from '../ModelMaterials';
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
  const shell = ref<Object3D>();
  const music = ref<AudioSource>();
  const roll = ref<AudioSource>();
  const star = ref<AudioSource>();
  const win = ref<AudioSource>();
  const crash = ref<AudioSource>();
  const drop = ref<AudioSource>();
  return (
    <Scene>
      {/* Unity's lighting, in its own amounts: flat white ambient at 1, the sun at 1 — three.js's
          physical units are π times Unity's — and Unity's Standard shader in gamma space keeps 0.78 of
          the light for diffuse (its dielectric reflects 0.22). Shadow strength 0.848. */}
      <AmbientLight intensity={Math.PI * 0.78} />

      <Group name="camContainer" ref={cam} position={[5, 2.73, 0]}>
        <PerspectiveCamera position={[9, 7, 0]} rotation={[-1.5708, 0.8727, 1.5708]} fov={60} near={0.3} far={1000}>
          <FitWidth />
        </PerspectiveCamera>
        {/* Unity's sun, kept over the egg so its shadows stay sharp along a long slope. Shadows reach
            40 m around it, as far as the Unity project's High quality cast them. */}
        <DirectionalLight intensity={Math.PI * 0.78} position={[-15.7555, 24.308, 7.8029]} castShadow shadow-intensity={0.848} shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-near={1} shadow-camera-far={72} shadow-bias={-0.0001} shadow-normalBias={0.03}>
          {/* Its target rides with it, so it shines the same way wherever the camera has followed the egg. */}
          <Object3D attach="target" position={[15.7555, -24.308, -7.8029]} />
        </DirectionalLight>
      </Group>

      <Group name="terrain">
        <TerrainMesh startTex={textures.start} endTex={textures.end} terrainData={slope} ground={ground} floor={floor} />
        <Group name="ground" ref={ground}>
          <Terrain terrainData={slope} castShadows={true} sideProjection={false} />
          <TerrainCollider terrainData={slope} friction={0.6} />
        </Group>
        <Group name="level">
          <LevelController nest={nest} stones={[Stone1, Stone2, Stone3]} star={Star} />
          <Group name="nest" ref={nest} rotation={[2.8677, -0.6099, 2.699]}>
            <Nest />
            <NestModel />
            <ModelMaterials materials={[materials.nest, materials.leaves, materials.leaves]} />
            <BoxCollider size={[4.85, 2.41, 3.17]} isTrigger />
          </Group>
        </Group>
      </Group>

      <Mesh name="floor" ref={floor} rotation={[-Math.PI / 2, 0, 0]} material={materials.floor} receiveShadow>
        <PlaneGeometry args={[40, 40]} />
        <BoxCollider size={[40, 40, 0.2]} center={[0, 0, -0.1]} />
      </Mesh>

      <Group name="egg" position={[13.11, 2.36, 0]}>
        <EggModel ref={shell} />
        <ModelMaterials material={materials.egg} />
        <Rigidbody isKinematic />
        {/* Unity's egg weighs a kilogram: its hull is about 0.47 m³. Its physic material grips at 1 moving, 0.6 at
            rest; Rapier's single friction needs more to grip as PhysX's contact patches do. At 2.4 a held push gets
            over the start bump as soon as it did in Unity, and lands no harder. */}
        <MeshCollider convex density={2.15} friction={2.4} />
        <EggController camContainer={cam} shell={shell} topPart={EggTop} bottomPart={EggBottom} fried={Fried} />
      </Group>

      {/* The Unity prefab's AudioSources, with their volumes: one an object, so each is named. */}
      <Group name="music">
        <MusicController backMusic={music} rollSound={roll} starSound={star} winSound={win} crashSound={crash} dropSound={drop} />
        <Group name="back music">
          <AudioSource ref={music} clip={sounds.music} volume={0.558} loop playOnAwake={false} />
        </Group>
        <Group name="rolling">
          <AudioSource ref={roll} clip={sounds.roll} volume={0} loop playOnAwake={false} />
        </Group>
        <Group name="star">
          <AudioSource ref={star} clip={sounds.star} playOnAwake={false} />
        </Group>
        <Group name="win">
          <AudioSource ref={win} clip={sounds.win} playOnAwake={false} />
        </Group>
        <Group name="crash">
          <AudioSource ref={crash} clip={sounds.crash} playOnAwake={false} />
        </Group>
        <Group name="drop">
          <AudioSource ref={drop} clip={sounds.drop} playOnAwake={false} />
        </Group>
      </Group>
      {/* Unity's portrait canvas, 1080 × 1920, for the UI and the gradient behind the scene alike. */}
      <Group name="ui">
        <UIDocument element="backdrop" referenceResolution={[1080, 1920]} />
        <UIDocument element="ui" referenceResolution={[1080, 1920]} />
        <UIController />
      </Group>
    </Scene>
  );
};
