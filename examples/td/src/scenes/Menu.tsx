import { Color, DirectionalLight, Fog, Group, HemisphereLight, PerspectiveCamera, Scene } from 'three';
import { UIDocument } from '@scenoco-three/core';
import { AudioSource } from '@scenoco-three/audio';
import { MenuCamera } from '../MenuCamera';
import { MenuController } from '../MenuController';
import { Sfx, sounds } from '../Sfx';
import { SoundSetting } from '../SoundSetting';
import { Look } from './Look';
import { FilmGrain, Vignette, Volume } from '@scenoco-three/postprocessing';
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
      shadow-camera-top={36} shadow-camera-bottom={-36} shadow-camera-near={1} shadow-camera-far={80}
      shadow-bias={-0.0001} shadow-normalBias={0.05}
    />
    <Look />
    {/* The title only: a painted, filmic frame over the turning map — a second Volume's effects. */}
    <Group name="title look">
      <Volume priority={1} />
      <FilmGrain intensity={0.18} />
      <Vignette intensity={0.32} smoothness={0.45} />
    </Group>
    <PerspectiveCamera fov={45}>
      <MenuCamera />
    </PerspectiveCamera>
    <MeadowWorld />
    <Group name="menu">
      <UIDocument referenceResolution={[960, 540]} />
      <MenuController />
      <AudioSource clip={sounds.click} playOnAwake={false} />
      <Sfx />
      <SoundSetting />
    </Group>
  </Scene>
);
