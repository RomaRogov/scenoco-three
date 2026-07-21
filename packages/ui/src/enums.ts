import { enumOf } from '@scenoco-three/core';

/**
 * Identity enums for uikit's string-literal properties — the DSL attribute value
 * IS the uikit value, verbatim (`flexDirection="row"`), so authored XML reads
 * exactly like uikit/CSS. Member lists mirror `@pmndrs/uikit`'s schemas.
 */

export const FlexDirection = enumOf('FlexDirection', ['column', 'column-reverse', 'row', 'row-reverse']);

export const FlexWrap = enumOf('FlexWrap', ['no-wrap', 'wrap', 'wrap-reverse']);

export const JustifyContent = enumOf('JustifyContent', [
  'flex-start',
  'center',
  'flex-end',
  'space-between',
  'space-around',
  'space-evenly',
]);

const alignMembers = [
  'auto',
  'flex-start',
  'center',
  'flex-end',
  'stretch',
  'baseline',
  'space-between',
  'space-around',
  'space-evenly',
] as const;

export const AlignItems = enumOf('AlignItems', alignMembers);

export const AlignSelf = enumOf('AlignSelf', alignMembers);

export const PositionType = enumOf('PositionType', ['static', 'relative', 'absolute']);

export const Overflow = enumOf('Overflow', ['visible', 'hidden', 'scroll']);

export const Display = enumOf('Display', ['flex', 'none', 'contents']);

export const TextAlign = enumOf('TextAlign', ['left', 'center', 'right', 'justify']);

export const VerticalAlign = enumOf('VerticalAlign', ['top', 'center', 'bottom']);

export const ObjectFit = enumOf('ObjectFit', ['fill', 'cover']);

export const PointerEvents = enumOf('PointerEvents', ['auto', 'none', 'listener']);
