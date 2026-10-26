import {
  Color, DirectionalLight, Fog, GridHelper, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene,
} from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { BoxCollider, Rigidbody, RigidbodyConstraints } from '@scenoco-three/rapier';
import { CameraFit } from '../CameraFit';
import { Respawn } from '../Respawn';
import { Selector } from '../Selector';

/** How every letter is cut: three.js's own bold Helvetiker, extruded and bevelled. */
const letter = { font: new Font(helvetiker), size: 1.6, depth: 0.6, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035 };

/** One letter: it falls and lands on the box its collider fits around it; it may tip sideways, never turn away. */
const Letter = ({ char, color, position }: { char: string; color: string; position: [number, number, number] }) => (
  <Mesh name={char} position={position} castShadow receiveShadow>
    <TextGeometry args={[char, letter]} />
    <MeshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
    <Rigidbody angularDamping={0.4} constraints={RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationY} />
    <BoxCollider friction={0.9} bounciness={0.1} />
    <Respawn />
  </Mesh>
);

/** The word falls onto a grid; tap a letter to move it. */
export const Home = () => (
  <Scene>
    <Color attach="background" args={['#05070d']} />
    <Fog attach="fog" args={['#05070d', 16, 42]} />
    <HemisphereLight args={['#cfe6ff', '#0b1220', 0.9]} />
    <DirectionalLight
      position={[5, 12, 8]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}
      shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10}
    />
    <PerspectiveCamera position={[0, 3.4, 12.5]} rotation={[-0.16, 0, 0]}>
      <CameraFit width={12.5} height={7.5} distance={12.5} />
    </PerspectiveCamera>

    {/* the ground: a dark floor with a grid, and the box the letters land on */}
    <Mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <PlaneGeometry args={[80, 80]} />
      <MeshStandardMaterial color="#070b14" roughness={1} />
    </Mesh>
    <GridHelper args={[80, 80, '#2b5179', '#12233a']} position={[0, 0.002, 0]} />
    <Group position={[0, -0.5, 0]}>
      <BoxCollider size={[80, 1, 80]} friction={0.9} />
    </Group>

    {/* each letter starts at its own height, its lower-left corner above its place in the word */}
    <Letter char="s" color="#4af0e0" position={[-5.35, 5.9, -0.3]} />
    <Letter char="c" color="#38bdf8" position={[-3.8, 7.9, -0.3]} />
    <Letter char="e" color="#818cf8" position={[-2.17, 6.79, -0.3]} />
    <Letter char="n" color="#c084fc" position={[-0.54, 8.98, -0.3]} />
    <Letter char="o" color="#f472b6" position={[0.99, 7.4, -0.3]} />
    <Letter char="c" color="#fb923c" position={[2.6, 9.8, -0.3]} />
    <Letter char="o" color="#facc15" position={[4.19, 8.4, -0.3]} />

    <Selector />
  </Scene>
);
