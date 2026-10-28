import {
  Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene,
} from 'three';
import { ref } from '@scenoco-three/core';
import { SplineAnimate, SplineContainer, SplineInstantiate, SplineMesh } from '@scenoco-three/splines';
import { roadPiece } from '../assets';
import { ChaseCamera } from '../ChaseCamera';
import { Car, Lamp, Tree } from '../prefabs';

/** A closed track: one modelled road piece bent along a spline, lamps and trees placed by it, two cars driving it. */
export const Race = () => {
  const track = ref<Group>();
  const knots = ref<Group>();
  const leader = ref<Group>();
  return (
    <Scene>
      <Color attach="background" args={['#9fc6e8']} />
      <Fog attach="fog" args={['#9fc6e8', 90, 260]} />
      <HemisphereLight args={['#dff0ff', '#4a5a3a', 1.2]} />
      <DirectionalLight
        position={[40, 80, 30]} intensity={2.2} castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-100} shadow-camera-right={100}
        shadow-camera-top={100} shadow-camera-bottom={-100} shadow-camera-far={250} shadow-bias={-0.0004}
      />

      <PerspectiveCamera position={[0, 110, 45]} args={[55, 1, 0.1, 600]}>
        <ChaseCamera target={leader} />
      </PerspectiveCamera>

      <Mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -35]} receiveShadow>
        <PlaneGeometry args={[400, 400]} />
        <MeshStandardMaterial color="#6f9a4f" roughness={1} />
      </Mesh>

      {/* the track: knots in order, at the height where the road piece's shoulders meet the ground —
          nodes, so the editor's gizmo moves them and the road follows. Flat: a banked turn (a
          knot's roll) tilts the whole piece, so it needs ground shaped to it. */}
      <Group ref={track}>
        <SplineContainer closed knots={knots} />
        <Group ref={knots}>
          <Object3D position={[0, 0.55, 0]} />
          <Object3D position={[45, 0.55, 0]} />
          <Object3D position={[70, 0.55, -20]} />
          <Object3D position={[65, 0.55, -60]} />
          <Object3D position={[30, 0.55, -75]} />
          <Object3D position={[-10, 0.55, -65]} />
          <Object3D position={[-40, 0.55, -75]} />
          <Object3D position={[-65, 0.55, -50]} />
          <Object3D position={[-55, 0.55, -15]} />
          <Object3D position={[-30, 0.55, 5]} />
        </Group>
      </Group>

      {/* the road: the Blender piece, repeated end to end and bent along the track */}
      <Mesh receiveShadow castShadow>
        <SplineMesh container={track} mesh={roadPiece} />
      </Mesh>

      <Group>
        <SplineInstantiate container={track} itemsToInstantiate={[Lamp]} spacing={24} positionOffset={[9, -0.55, 0]} alignTo="world" />
      </Group>
      <Group>
        <SplineInstantiate container={track} itemsToInstantiate={[Tree]} spacing={9} positionOffset={[18, -0.55, 0]} alignTo="world" />
      </Group>

      <Group ref={leader}>
        <SplineAnimate container={track} animationMethod="speed" maxSpeed={26} />
        <Car />
      </Group>
      <Group>
        <SplineAnimate container={track} animationMethod="speed" maxSpeed={23} startOffset={0.08} />
        <Car />
      </Group>
    </Scene>
  );
};
