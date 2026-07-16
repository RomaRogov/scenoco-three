import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Matrix3,
  Matrix4,
  RawShaderMaterial,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Mesh,
  type Side,
} from 'three';
import { Attachment } from '../base.js';
import { attachment, property, ValueType } from '../../registry/decorators.js';
import { enumOf } from '../../registry/EnumRegistry.js';
import type { AttachContext } from '../../registry/NodeRegistry.js';
import type { CompiledScalar } from '../../scene/types.js';
import type { CompiledUniform } from '../../scene/compiled.js';
import { MATERIAL_TARGETS } from '../targets.js';

/** Which faces render — the value is the native three constant. */
export const MaterialSide = enumOf('Side', { front: FrontSide, back: BackSide, double: DoubleSide });

/**
 * A custom GLSL shader material. `vertex`/`fragment` reference `.vert`/`.frag`
 * files (resolved + inlined at compile time); shader inputs are declared as
 * `<Uniform name type value>` children, validated against the shader at compile.
 * A component on the node can animate a uniform: `this.node.material.uniforms.uTime.value = t`.
 */
@attachment({
  name: 'ShaderMaterial',
  target: MATERIAL_TARGETS,
  group: 'material',
  children: ['Uniform'],
  description: 'Custom GLSL shader material (vertex/fragment files + declared <Uniform>s).',
})
export class ShaderMaterialNode extends Attachment<Mesh> {
  @property({ type: ValueType.String, description: 'Vertex shader — a .vert/.glsl path (inlined at compile)' })
  vertex = '';
  @property({ type: ValueType.String, description: 'Fragment shader — a .frag/.glsl path (inlined at compile)' })
  fragment = '';
  @property({ type: ValueType.Bool, description: 'Use RawShaderMaterial (no three preamble/built-ins)' })
  raw = false;
  @property({ type: ValueType.Bool, description: 'Enable alpha blending (use with opacity)' }) transparent = false;
  @property({ type: ValueType.Float, description: 'Opacity, 0 (transparent) to 1 (opaque)' }) opacity = 1;
  @property({ type: ValueType.Bool, description: 'Render as wireframe' }) wireframe = false;
  @property({ type: MaterialSide, description: 'Which faces render' })
  side: number = FrontSide;

  private uniformDecls: CompiledUniform[] = [];
  /** Invoked by the attachment loader with the asset's `<Uniform>` declarations. */
  setUniforms(uniforms?: CompiledUniform[]): void {
    this.uniformDecls = uniforms ?? [];
  }

  private cached?: ShaderMaterial | RawShaderMaterial;
  attach(ctx: AttachContext<Mesh>): void {
    if (!this.cached) {
      const uniforms: Record<string, IUniform> = {};
      for (const u of this.uniformDecls) uniforms[u.name] = { value: toUniformValue(u.type, u.value) };
      const Ctor = this.raw ? RawShaderMaterial : ShaderMaterial;
      this.cached = new Ctor({
        vertexShader: this.vertex,
        fragmentShader: this.fragment,
        uniforms,
        transparent: this.transparent,
        opacity: this.opacity,
        wireframe: this.wireframe,
        side: this.side as Side,
      });
    }
    ctx.node.material = this.cached;
  }
}

/** Convert a compiled uniform value to the Three.js type the shader expects. */
function toUniformValue(type: string, value: CompiledScalar): unknown {
  switch (type) {
    case 'vec2':
      return new Vector2().fromArray(value as number[]);
    case 'vec3':
      return new Vector3().fromArray(value as number[]);
    case 'vec4':
      return new Vector4().fromArray(value as number[]);
    case 'color':
      return new Color(value as number);
    case 'mat3':
      return new Matrix3().fromArray(value as number[]);
    case 'mat4':
      return new Matrix4().fromArray(value as number[]);
    case 'sampler2D':
      // Loaded as a URL; the value updates when the image arrives. Skipped headless (no Image).
      return typeof Image !== 'undefined' ? new TextureLoader().load(value as string) : null;
    default:
      return value; // float / int / bool
  }
}
