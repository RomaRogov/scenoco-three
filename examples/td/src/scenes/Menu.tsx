import { Color, DirectionalLight, Fog, Group, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { UIDocument } from '@scenoco-three/core';
import { AudioSource } from '@scenoco-three/audio';
import { MenuCamera } from '../MenuCamera';
import { MenuController } from '../MenuController';
import { Sfx, sounds } from '../Sfx';
import { MeadowWorld } from './worlds';

/** The title: the first map turning slowly under the level cards. */
export const Menu = () => (
  <Scene>
    <Color attach="background" args={['#a8dcf5']} />
    <Fog attach="fog" args={['#a8dcf5', 50, 110]} />
    <HemisphereLight args={['#fff4dc', '#56784a', 1.5]} />
    <DirectionalLight
      position={[16, 32, 12]} intensity={2.3} castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-36} shadow-camera-right={36}
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-far={90} shadow-bias={-0.0005}
    />
    <PerspectiveCamera fov={45}>
      <MenuCamera />
    </PerspectiveCamera>
    <MeadowWorld />
    <Group name="menu">
      <UIDocument referenceResolution={[960, 540]} />
      <MenuController />
      <AudioSource clip={sounds.click} playOnAwake={false} />
      <Sfx />
    </Group>
  </Scene>
);
