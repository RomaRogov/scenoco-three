import { HemisphereLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property, ValueType } from '../../registry/decorators.js';

@node({ name: 'HemisphereLight', description: 'Sky/ground gradient light' })
export class HemisphereLightNode extends Object3DNode {
  @property({ type: ValueType.Color, description: 'Sky color' }) color = 0xffffff;
  @property({ type: ValueType.Color, description: 'Ground color' }) groundColor = 0xffffff;
  @property({ type: ValueType.Float, description: 'Light intensity' }) intensity = 1;

  build(): HemisphereLight {
    return new HemisphereLight(this.color, this.groundColor, this.intensity);
  }
}
