import { Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, Object3D, PerspectiveCamera, Scene } from 'three';
import { ref } from '@scenoco-three/core';
import { SplineAnimate, SplineContainer, SplineInstantiate, SplineMesh } from '@scenoco-three/splines';
import { Terrain } from '@scenoco-three/terrain';
import { ground, models } from '../assets';
import { ChaseCamera } from '../ChaseCamera';
import { Car, Drone, Lamp } from '../prefabs';
import { RaceControl } from '../RaceControl';
import { Scatter } from '../Scatter';
import { TouchStick } from '../TouchStick';

/**
 * A closed track over generated ground: one modelled road piece bent along a spline, the terrain
 * carved flat under it (the asset lab's `lab terrain terrain/track.json`, from the same knots), lamps
 * placed by it, woods and rocks strewn around, and three arcade cars racing it — the player's, and two the spline drives, each in its own lane. A
 * drone circles above on `SplineAnimate`.
 */
export const Race = () => {
  const track = ref<Group>();
  const knots = ref<Group>();
  return (
    <Scene>
      <Color attach="background" args={['#9fc6e8']} />
      {/* Close enough to hide where the ground ends. */}
      <Fog attach="fog" args={['#9fc6e8', 70, 200]} />
      <HemisphereLight args={['#dff0ff', '#4a5a3a', 1.2]} />
      <DirectionalLight
        position={[40, 80, 30]} intensity={2.2} castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-100} shadow-camera-right={100}
        shadow-camera-top={100} shadow-camera-bottom={-100} shadow-camera-far={250} shadow-bias={-0.0004}
      />

      <PerspectiveCamera position={[0, 80, 30]} args={[55, 1, 0.1, 600]}>
        <ChaseCamera />
      </PerspectiveCamera>

      <Group name="ground">
        <Terrain terrainData={ground} sideProjection />
      </Group>

      {/* the track: knots in order — nodes, so the editor's gizmo moves them and the road follows —
          each at the carved ground's height there plus 12 cm, the asphalt just proud of the ground.
          The terrain was carved along these same x, z (terrain/track.json): move one sideways and
          carve the terrain again. No banking: a knot's roll tilts the whole piece. */}
      <Group ref={track}>
        <SplineContainer closed knots={knots} />
        <Group ref={knots}>
          <Object3D position={[0, 7.05, 0]} />
          <Object3D position={[45, 7.08, 0]} />
          <Object3D position={[70, 7.29, -20]} />
          <Object3D position={[65, 7.57, -60]} />
          <Object3D position={[30, 8.26, -75]} />
          <Object3D position={[-10, 8.78, -65]} />
          <Object3D position={[-40, 8.79, -75]} />
          <Object3D position={[-65, 7.33, -50]} />
          <Object3D position={[-55, 6.5, -15]} />
          <Object3D position={[-30, 6.74, 5]} />
        </Group>
      </Group>

      {/* the road: the Blender piece, repeated end to end and bent along the track */}
      <Mesh receiveShadow castShadow>
        <SplineMesh container={track} mesh={models.road} />
      </Mesh>

      <Group>
        <SplineInstantiate container={track} itemsToInstantiate={[Lamp]} spacing={24} positionOffset={[9, -0.12, 0]} alignTo="world" />
      </Group>

      {/* Woods and rocks over the ground, clear of the track. */}
      <Group name="scenery">
        <Scatter items={[models.pine, models.tree]} count={420} seed={3} height={7} />
        <Scatter items={[models.rock]} count={90} seed={8} height={1.4} minScale={0.6} maxScale={2.2} clearTrack={13} />
      </Group>

      <RaceControl laps={3} tracks={[Race]} />
      <TouchStick element="stick" axis="Horizontal" />

      {/* The grid, just past the start line, the track running +X: each car in its own lane — left of
          the centre line is -Z here — the player at the back. */}
      <Car position={[22, 7.08, -2.5]} rotation={[0, Math.PI / 2, 0]} color="#2f7de2" lane={2.5} pace={0.88} />
      <Car position={[14, 7.08, 2.5]} rotation={[0, Math.PI / 2, 0]} color="#f2b21b" lane={-2.5} pace={0.84} />
      <Car position={[6, 7.06, 0]} rotation={[0, Math.PI / 2, 0]} color="#e2412f" human />

      <Group>
        <SplineAnimate container={track} animationMethod="speed" maxSpeed={18} startOffset={0.5} />
        <Drone />
      </Group>
    </Scene>
  );
};
