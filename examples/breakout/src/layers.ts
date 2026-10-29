import { Physics2D } from '@scenoco-three/box2d';

/**
 * The physics layers, as Unity's Layer list names them. Everything not named here is on 0 — walls,
 * bricks, the paddle, the floor — and meets everything.
 */
export const Layer = { ball: 1, pickup: 2, bolt: 3 } as const;

// Balls pass through each other, as Breakout's always have; pickups and bolts are sensors that only
// care about the paddle and the bricks.
Physics2D.ignoreLayerCollision(Layer.ball, Layer.ball);
Physics2D.ignoreLayerCollision(Layer.ball, Layer.pickup);
Physics2D.ignoreLayerCollision(Layer.ball, Layer.bolt);
Physics2D.ignoreLayerCollision(Layer.pickup, Layer.pickup);
Physics2D.ignoreLayerCollision(Layer.pickup, Layer.bolt);
Physics2D.ignoreLayerCollision(Layer.bolt, Layer.bolt);
