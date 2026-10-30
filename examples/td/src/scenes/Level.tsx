import { Group } from 'three';
import { UIDocument } from '@scenoco-three/core';
import { AudioSource } from '@scenoco-three/audio';
import { Game } from '../Game';
import type { LevelId } from '../levels';
import { Sfx, sounds } from '../Sfx';
import { RangeMarker } from './prefabs';

/** What every level has besides its map: the run itself, its sounds, and the range marker. */
export const LevelRules = ({ level }: { level: LevelId }) => (
  <Group name="rules">
    <Group name="Game">
      <UIDocument referenceResolution={[960, 540]} />
      <Game level={level} />
      <AudioSource clip={sounds.click} playOnAwake={false} />
      <Sfx />
    </Group>
    <RangeMarker />
  </Group>
);
