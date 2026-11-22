import { Group } from 'three';
import { UIDocument, prefab } from '@scenoco-three/core';
import { AudioSource } from '@scenoco-three/audio';
import { BuildController } from '../BuildController';
import { Game } from '../Game';
import { HudController } from '../HudController';
import type { LevelId } from '../levels';
import { Sfx, sounds } from '../Sfx';
import { TimeControls } from '../TimeControls';
import { WaveSpawner } from '../WaveSpawner';
import { SoundSetting } from '../SoundSetting';
import { RangeMarker } from './prefabs';

/**
 * What every level has besides its map: the run — its rules, waves, building, time and HUD, a
 * component each on one node, as on a Unity GameObject — its sounds, and the range marker.
 */
export const LevelRules = prefab(({ level = 'meadow' }: { level?: LevelId }) => (
  <Group>
    <Group name="Game">
      <UIDocument referenceResolution={[960, 540]} />
      <Game level={level} />
      <WaveSpawner />
      <BuildController />
      <TimeControls />
      <HudController />
      <SoundSetting />
      <AudioSource clip={sounds.click} playOnAwake={false} />
      <Sfx />
    </Group>
    <RangeMarker />
  </Group>
));
