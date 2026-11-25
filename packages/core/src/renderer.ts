import type { Color, ColorRepresentation, Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, Scene, Vector2, Vector3, Vector4, WebGLRenderer } from 'three';

/** The kernel's types are three.js's: `this.node` is an `Object3D`, `game.renderer` a `WebGLRenderer`. */
declare module '@scenoco/kernel' {
  interface Renderer {
    node: Object3D;
    camera: PerspectiveCamera | OrthographicCamera;
    scene: Scene;
    view: WebGLRenderer;
    viewOptions: {
      /**
       * The renderer to draw with, for what only its constructor sets — `new WebGLRenderer({ alpha: true,
       * powerPreference: 'high-performance' })`. One without antialiasing when left out: crisp pixels,
       * and none of the multisampling's cost to fill on a phone or a tablet.
       */
      renderer?: WebGLRenderer;
    };
    vector2: Vector2;
    vector3: Vector3;
    quaternion: Quaternion;
    color: Color;
    colorInput: ColorRepresentation;
    nameKey: 'name';
    /** What a tween moves besides a number. */
    values: Vector2 | Vector3 | Vector4 | Color | Quaternion;
  }
}
