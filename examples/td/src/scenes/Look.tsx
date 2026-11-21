import { Group } from 'three';
import { prefab } from '@scenoco-three/core';
import { ColorAdjustments, Tonemapping, Volume } from '@scenoco-three/postprocessing';

/** The picture every scene draws with: ACES, a tenth of a stop brighter — URP's Volume and its profile. */
export const Look = prefab(() => (
  <Group>
    <Volume />
    <Tonemapping mode="ACES" />
    <ColorAdjustments postExposure={0.1375} />
  </Group>
));
