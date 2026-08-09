import { property, Object3DNode, ValueType } from '@scenoco-three/core';
import {
  AlignItems,
  AlignSelf,
  Display,
  FlexDirection,
  FlexWrap,
  JustifyContent,
  Overflow,
  PointerEvents,
  PositionType,
  TextAlign,
  VerticalAlign,
} from '../enums.js';

/**
 * Shared base for the UI element node tags — thin factories over pmndrs uikit.
 * Each tag builds the uikit class of the same name (`<Container>` → uikit
 * `Container`, …), and attribute names/values are uikit property names/values
 * **verbatim**, so both the XML and any runtime `setProperties` code read
 * exactly like the uikit docs.
 *
 * Every uikit element is a real `THREE.Mesh`, so these are ordinary scene nodes:
 * they nest in the scene tree (uikit lays children out via yoga flexbox), carry
 * `<Components>`, and are referenced from components like any other node. Layout
 * runs in `UIRenderSystem`, which updates each UI root once per frame.
 *
 * Sizing/spacing attributes are authored the CSS way: a number (`width="250"`),
 * a percentage (`width="50%"`), or `auto` — passed straight through to uikit.
 * Position/rotation/scale of *nested* elements are driven by flexbox layout, not
 * by the transform attributes; a root element (a `<Container>` outside any UI
 * parent — world-space UI) is placed with the usual transform attributes.
 */
export abstract class UIElementNode extends Object3DNode {
  // ---- size -----------------------------------------------------------------
  @property({ type: ValueType.String, description: 'Width: number, "50%", or "auto"' }) width?: string;
  @property({ type: ValueType.String, description: 'Height: number, "50%", or "auto"' }) height?: string;
  @property({ type: ValueType.String, description: 'Minimum width: number or "50%"' }) minWidth?: string;
  @property({ type: ValueType.String, description: 'Minimum height: number or "50%"' }) minHeight?: string;
  @property({ type: ValueType.String, description: 'Maximum width: number or "50%"' }) maxWidth?: string;
  @property({ type: ValueType.String, description: 'Maximum height: number or "50%"' }) maxHeight?: string;
  @property({ type: ValueType.Float, description: 'Width / height ratio kept when the other side is auto' })
  aspectRatio?: number;

  // ---- flex child -----------------------------------------------------------
  @property({ type: ValueType.Float, description: 'Share of leftover space this element grows by (CSS flex-grow)' })
  flexGrow?: number;
  @property({ type: ValueType.Float, description: 'How much this element shrinks under overflow (CSS flex-shrink)' })
  flexShrink?: number;
  @property({ type: ValueType.String, description: 'Initial main-axis size before grow/shrink: number, "50%", or "auto"' })
  flexBasis?: string;
  @property({ type: AlignSelf, description: 'Cross-axis alignment override for this element (CSS align-self)' })
  alignSelf?: string;

  // ---- margin / absolute position -------------------------------------------
  @property({ type: ValueType.String, description: 'Margin on all sides: number, "5%", or "auto"' }) margin?: string;
  @property({ type: ValueType.String, description: 'Top margin: number, "5%", or "auto"' }) marginTop?: string;
  @property({ type: ValueType.String, description: 'Right margin: number, "5%", or "auto"' }) marginRight?: string;
  @property({ type: ValueType.String, description: 'Bottom margin: number, "5%", or "auto"' }) marginBottom?: string;
  @property({ type: ValueType.String, description: 'Left margin: number, "5%", or "auto"' }) marginLeft?: string;
  @property({ type: PositionType, description: 'Layout mode: relative (in flow) or absolute (out of flow)' })
  positionType?: string;
  @property({ type: ValueType.String, description: 'Offset from parent top when positionType="absolute"' })
  positionTop?: string;
  @property({ type: ValueType.String, description: 'Offset from parent right when positionType="absolute"' })
  positionRight?: string;
  @property({ type: ValueType.String, description: 'Offset from parent bottom when positionType="absolute"' })
  positionBottom?: string;
  @property({ type: ValueType.String, description: 'Offset from parent left when positionType="absolute"' })
  positionLeft?: string;

  // ---- children layout (flex container) --------------------------------------
  @property({ type: FlexDirection, description: 'Main axis of children layout (CSS flex-direction)' })
  flexDirection?: string;
  @property({ type: FlexWrap, description: 'Whether children wrap onto multiple lines (CSS flex-wrap)' })
  flexWrap?: string;
  @property({ type: JustifyContent, description: 'Children distribution along the main axis (CSS justify-content)' })
  justifyContent?: string;
  @property({ type: AlignItems, description: 'Children alignment along the cross axis (CSS align-items)' })
  alignItems?: string;
  @property({ type: ValueType.String, description: 'Gap between children: number or "5%"' }) gap?: string;
  @property({ type: ValueType.String, description: 'Padding on all sides: number or "5%"' }) padding?: string;
  @property({ type: ValueType.String, description: 'Top padding: number or "5%"' }) paddingTop?: string;
  @property({ type: ValueType.String, description: 'Right padding: number or "5%"' }) paddingRight?: string;
  @property({ type: ValueType.String, description: 'Bottom padding: number or "5%"' }) paddingBottom?: string;
  @property({ type: ValueType.String, description: 'Left padding: number or "5%"' }) paddingLeft?: string;
  @property({ type: Overflow, description: 'How children outside the bounds behave (visible/hidden/scroll)' })
  overflow?: string;
  @property({ type: Display, description: 'Set "none" to hide the element and remove it from layout' })
  display?: string;
  @property({
    type: PointerEvents,
    description:
      'Whether this element blocks/receives pointer rays: "auto" (yes, CSS default), "none" (click-through), "listener" (only with listeners attached)',
  })
  pointerEvents?: string;

  // ---- appearance -----------------------------------------------------------
  @property({ type: ValueType.Color, description: 'Background panel color' }) backgroundColor?: number;
  /**
   * uikit has no panel-only alpha: `opacity` is **inherited**, so it fades this
   * element's text and children with it. For a translucent panel behind readable
   * text, give the panel its own element — an absolutely-positioned sibling
   * filling the parent, carrying the background and the opacity, with the content
   * beside it at full strength. (This replaced a `backgroundOpacity` attribute
   * that uikit has never had; uikit drops unknown properties without a word, so
   * every use of it silently did nothing.)
   */
  @property({ type: ValueType.Float, description: 'Opacity 0..1 — inherited, so it fades child text too' })
  opacity?: number;
  @property({ type: ValueType.Float, description: 'Corner radius of the background panel' }) borderRadius?: number;
  @property({ type: ValueType.Float, description: 'Border width around the background panel' }) borderWidth?: number;
  @property({ type: ValueType.Color, description: 'Border color' }) borderColor?: number;

  // ---- text style (inherited by descendant <Text> elements, like CSS) --------
  @property({ type: ValueType.Color, description: 'Text color (inherited by descendant Text elements)' })
  color?: number;
  @property({ type: ValueType.Float, description: 'Font size in UI units (inherited)' }) fontSize?: number;
  @property({ type: ValueType.String, description: 'Font weight: "normal", "bold", or a number like "600" (inherited)' })
  fontWeight?: string;
  @property({ type: ValueType.String, description: 'Font family name registered on the UI root (inherited)' })
  fontFamily?: string;
  @property({ type: TextAlign, description: 'Horizontal text alignment (inherited)' }) textAlign?: string;
  @property({ type: VerticalAlign, description: 'Vertical text alignment (inherited)' }) verticalAlign?: string;
  @property({ type: ValueType.String, description: 'Line height: number or "150%" (inherited)' }) lineHeight?: string;
  @property({ type: ValueType.Float, description: 'Extra spacing between characters (inherited)' })
  letterSpacing?: number;

  /** Own `@property` fields that were set, as a uikit properties object. */
  protected uikitProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) if (value !== undefined) props[key] = value;
    return props;
  }
}
