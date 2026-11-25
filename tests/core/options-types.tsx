import { Object3D, Texture } from 'three';

/**
 * Typecheck-only: an attribute takes what the class's options object takes for it. Shaped as pixi's
 * classes are — a setter wider than its getter, and one options object the constructor takes in
 * place of a texture — so pixi's `style={{ fontSize: 24 }}` checks with no table of names.
 */
class Style {
  fontSize = 12;
  clone(): Style {
    return new Style();
  }
}
interface StyleOptions {
  fontSize?: number;
}
interface BadgeOptions {
  style?: Style | StyleOptions;
  text?: string;
  /** The constructor's alone: no property of this name. */
  resolution?: number;
}

class Badge extends Object3D {
  text = '';
  private own = new Style();
  constructor(options?: BadgeOptions | Texture) {
    super();
    void options;
  }
  get style(): Style {
    return this.own;
  }
  set style(value: Style | StyleOptions) {
    this.own.fontSize = value.fontSize ?? this.own.fontSize;
  }
}

export const Probe = () => (
  <Badge style={{ fontSize: 24 }} text="score">
    {/* @ts-expect-error a field the options do not take either */}
    <Badge style={{ fontSise: 24 }} />
    {/* @ts-expect-error an option with no property of its name is the constructor's: it goes in args */}
    <Badge resolution={2} />
    <Badge args={[{ resolution: 2 }]} />
    <Badge args={[new Texture()]} />
  </Badge>
);
