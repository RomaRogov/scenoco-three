/** What a pickup gives the paddle. `none` is a brick that drops nothing. */
export type Bonus = 'none' | 'laser' | 'multi' | 'wide' | 'slim';
/** The bonuses in order: a table by bonus is a list in this order, as Unity serialises one. */
export const BONUSES = ['laser', 'multi', 'wide', 'slim'] as const;
