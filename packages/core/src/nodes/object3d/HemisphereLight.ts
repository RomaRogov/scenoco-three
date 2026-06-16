import { HemisphereLight } from 'three';
import { Object3DNode } from '../base.js';
import { node, property } from '../../core/decorators.js';

@node({ name: 'HemisphereLight', description: 'Sky/ground gradient light' })
export class HemisphereLightNode extends Object3DNode {
  @property({ type: 'color', default: 0xffffff, description: 'Sky color' }) color = 0xffffff;
  @property({ type: 'color', default: 0xffffff }) groundColor = 0xffffff;
  @property({ type: 'float', default: 1 }) intensity = 1;

  build(): HemisphereLight {
    return new HemisphereLight(this.color, this.groundColor, this.intensity);
  }
}
