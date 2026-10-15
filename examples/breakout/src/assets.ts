import { BoxGeometry, MeshStandardMaterial } from 'three';

// What several nodes share is made once, here, and named from the scenes: the two side walls have
// one shape, all three walls one material, and every brick of a tier one material — so a wall of
// fifty bricks holds one geometry and one material rather than fifty of each. Something that
// exists once — the paddle, the ball — is written inside the element that uses it instead.

export const geometry = {
  brick: new BoxGeometry(2.4, 0.8, 0.7),
  wallSide: new BoxGeometry(0.5, 16, 0.9),
};

export const paint = {
  wall: new MeshStandardMaterial({ color: '#243352', emissive: '#0b1224', emissiveIntensity: 0.6, roughness: 0.7, metalness: 0.3 }),
  brickSoft: new MeshStandardMaterial({ color: '#22d3ee', emissive: '#0e7490', emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.25 }),
  brickFirm: new MeshStandardMaterial({ color: '#c084fc', emissive: '#6d28d9', emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.25 }),
  brickHard: new MeshStandardMaterial({ color: '#fb7185', emissive: '#9f1239', emissiveIntensity: 1, roughness: 0.25, metalness: 0.35 }),
};
