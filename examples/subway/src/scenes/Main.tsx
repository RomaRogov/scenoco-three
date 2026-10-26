import {
  BoxGeometry, CapsuleGeometry, CircleGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry,
} from 'three';
import { ref } from '@scenoco-three/core';
import { ChaseCamera } from '../ChaseCamera';
import { Game } from '../Game';
import { Player } from '../Player';
import { Spawner } from '../Spawner';
import { skyTexture } from '../textures';

export const Main = () => {
  const runner = ref<Group>();
  const model = ref<Group>();
  const legL = ref<Group>();
  const legR = ref<Group>();
  const armL = ref<Group>();
  const armR = ref<Group>();
  return (
    <Scene background={skyTexture}>
      <Fog attach="fog" args={['#f3a37f', 38, 135]} />
      <HemisphereLight args={['#ffd9c0', '#4a3a66', 1.25]} />
      <DirectionalLight
        color="#ffc896" intensity={2.6} position={[-9, 15, 7]} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-13} shadow-camera-right={13}
        shadow-camera-top={24} shadow-camera-bottom={-24} shadow-camera-near={1} shadow-camera-far={60}
        shadow-bias={-0.0006}
      />

      <Mesh position={[0, 16, -170]}>
        <CircleGeometry args={[22, 48]} />
        <MeshBasicMaterial color="#ffe2a8" fog={false} />
      </Mesh>

      <Group name="Game">
        <Game />
        <Spawner />
      </Group>

      <PerspectiveCamera position={[0, 4.4, 7.6]} fov={60}>
        <ChaseCamera target={runner} />
      </PerspectiveCamera>

      <Group name="Player" ref={runner}>
        <Player model={model} legL={legL} legR={legR} armL={armL} armR={armR} />
        <Group ref={model}>
          <Group ref={legL} position={[-0.16, 0.85, 0]}>
            <Mesh position={[0, -0.4, 0]} castShadow>
              <BoxGeometry args={[0.24, 0.8, 0.26]} />
              <MeshStandardMaterial color="#2f4fa8" roughness={0.8} />
            </Mesh>
            <Mesh position={[0, -0.82, -0.06]} castShadow>
              <BoxGeometry args={[0.27, 0.14, 0.42]} />
              <MeshStandardMaterial color="#f4f4f4" roughness={0.5} />
            </Mesh>
          </Group>
          <Group ref={legR} position={[0.16, 0.85, 0]}>
            <Mesh position={[0, -0.4, 0]} castShadow>
              <BoxGeometry args={[0.24, 0.8, 0.26]} />
              <MeshStandardMaterial color="#2f4fa8" roughness={0.8} />
            </Mesh>
            <Mesh position={[0, -0.82, -0.06]} castShadow>
              <BoxGeometry args={[0.27, 0.14, 0.42]} />
              <MeshStandardMaterial color="#f4f4f4" roughness={0.5} />
            </Mesh>
          </Group>
          <Mesh position={[0, 1.2, 0]} scale={[1.15, 1, 0.85]} castShadow>
            <CapsuleGeometry args={[0.3, 0.38, 6, 14]} />
            <MeshStandardMaterial color="#e63946" roughness={0.7} />
          </Mesh>
          <Mesh position={[0, 1.3, 0.3]} castShadow>
            <BoxGeometry args={[0.46, 0.55, 0.22]} />
            <MeshStandardMaterial color="#ffc533" roughness={0.6} />
          </Mesh>
          <Group ref={armL} position={[-0.42, 1.5, 0]}>
            <Mesh position={[0, -0.3, 0]} castShadow>
              <BoxGeometry args={[0.17, 0.6, 0.17]} />
              <MeshStandardMaterial color="#e63946" roughness={0.7} />
            </Mesh>
            <Mesh position={[0, -0.66, 0]} castShadow>
              <SphereGeometry args={[0.1, 10, 8]} />
              <MeshStandardMaterial color="#f0c29a" />
            </Mesh>
          </Group>
          <Group ref={armR} position={[0.42, 1.5, 0]}>
            <Mesh position={[0, -0.3, 0]} castShadow>
              <BoxGeometry args={[0.17, 0.6, 0.17]} />
              <MeshStandardMaterial color="#e63946" roughness={0.7} />
            </Mesh>
            <Mesh position={[0, -0.66, 0]} castShadow>
              <SphereGeometry args={[0.1, 10, 8]} />
              <MeshStandardMaterial color="#f0c29a" />
            </Mesh>
          </Group>
          <Mesh position={[0, 1.82, 0]} castShadow>
            <SphereGeometry args={[0.25, 18, 14]} />
            <MeshStandardMaterial color="#f0c29a" roughness={0.6} />
          </Mesh>
          <Mesh position={[0, 1.88, 0]} castShadow>
            <SphereGeometry args={[0.27, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <MeshStandardMaterial color="#22c55e" roughness={0.6} />
          </Mesh>
          <Mesh position={[0, 1.9, 0.3]} castShadow>
            <BoxGeometry args={[0.32, 0.04, 0.22]} />
            <MeshStandardMaterial color="#16a34a" roughness={0.6} />
          </Mesh>
        </Group>
      </Group>
    </Scene>
  );
};
