import { Behaviour } from '@scenoco-three/core';

/** What Unity tagged "Stone": the egg breaks on touching one. */
export class Stone extends Behaviour {}

/** What Unity tagged "Nest": the egg that reaches its trigger has won. */
export class Nest extends Behaviour {}
