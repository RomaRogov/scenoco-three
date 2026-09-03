import { Canvas } from '@react-three/fiber';
import { createRoot } from 'react-dom/client';
import { Sketch } from './Scene.js';

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ fov: 45, position: [0, 3, 7], rotation: [(-15 * Math.PI) / 180, 0, 0] }}>
    <color attach="background" args={['#0b1120']} />
    <Sketch />
  </Canvas>,
);
