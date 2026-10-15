import {
  Box3Helper, Color, DirectionalLight, Fog, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene,
} from 'three';
import { ref } from '@scenoco-three/core';
import { BoxCollider, Rigidbody } from '@scenoco-three/rapier';
import { glyphs, selection } from '../assets';
import { CameraFit } from '../CameraFit';
import { FaceFront } from '../FaceFront';
import { Respawn } from '../Respawn';
import { Selector } from '../Selector';
import { ShadowSetup } from '../ShadowSetup';

/** The word falls onto a grid; tap a letter to move it. */
export const Home = () => {
  const outline = ref<Box3Helper>();
  return (
    <Scene>
      <Color attach="background" args={['#05070d']} />
      <Fog attach="fog" args={['#05070d', 16, 42]} />
      <HemisphereLight args={['#cfe6ff', '#0b1220', 0.9]} />
      <DirectionalLight
        position={[5, 12, 8]} intensity={2.4} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10}
        shadow-camera-top={10} shadow-camera-bottom={-10} shadow-camera-near={1} shadow-camera-far={40}
        shadow-bias={-0.0005}
      >
        <ShadowSetup />
      </DirectionalLight>

      <PerspectiveCamera position={[0, 3.4, 12.5]} rotation={[-0.16, 0, 0]}>
        <CameraFit width={12.5} height={7.5} distance={12.5} />
      </PerspectiveCamera>

      {/* the ground: a grid on a dark floor, and the box the letters land on */}
      <Mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <PlaneGeometry args={[80, 80]} />
        <MeshStandardMaterial color="#070b14" roughness={1} />
      </Mesh>
      <GridHelper args={[80, 80, '#2b5179', '#12233a']} position={[0, 0.002, 0]} />
      <Group position={[0, -0.5, 0]}>
        <BoxCollider size={[80, 1, 80]} friction={0.9} />
      </Group>

      {/* s c e n o c o — each starts at its own height above the ground, and falls */}
      <Mesh name="s" geometry={glyphs.s.geometry} position={[-4.8, 6.5, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#4af0e0" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.s.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="c" geometry={glyphs.c.geometry} position={[-3.2, 8.5, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#38bdf8" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.c.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="e" geometry={glyphs.e.geometry} position={[-1.6, 7.4, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#818cf8" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.e.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="n" geometry={glyphs.n.geometry} position={[0, 9.6, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#c084fc" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.n.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="o" geometry={glyphs.o.geometry} position={[1.6, 8, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#f472b6" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.o.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="c2" geometry={glyphs.c.geometry} position={[3.2, 10.4, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#fb923c" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.c.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>
      <Mesh name="o2" geometry={glyphs.o.geometry} position={[4.8, 9, 0]} castShadow receiveShadow>
        <MeshStandardMaterial color="#facc15" roughness={0.35} metalness={0.1} />
        <Rigidbody angularDamping={0.4} />
        <BoxCollider size={glyphs.o.size} friction={0.9} bounciness={0.1} />
        <FaceFront />
        <Respawn />
      </Mesh>

      {/* the selection: an outline the Selector fits to the picked letter, and its move gizmo */}
      <Box3Helper ref={outline} args={[selection, '#e2f3ff']} visible={false} />
      <Selector outline={outline} />
    </Scene>
  );
};
