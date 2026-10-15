/**
 * Undo and redo, as the files' text: each step is one attribute of one element, before and after,
 * exactly as written. Putting text back restores what a person wrote — `-Math.PI / 2` too, not the
 * number it became. The stacks live in the tab's session storage, so they outlast the reload that
 * removing an attribute needs.
 */
import type { Address, Value } from './docs.js';

/** An attribute as it stood: its text (null for a bare flag) and what it reads as. */
export interface Written {
  text: string | null;
  value: Value;
}

export interface Step extends Address {
  name: string;
  /** null: the attribute was not written. */
  before: Written | null;
  after: Written | null;
}

const KEY = `scenoco-editor-history:${location.pathname}`;

export class History {
  private undos: Step[] = [];
  private redos: Step[] = [];

  constructor() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { undos: Step[]; redos: Step[] } | null;
      if (saved) ({ undos: this.undos, redos: this.redos } = saved);
    } catch {
      // No storage, or something unreadable in it: start empty.
    }
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** A new change: what could be redone is gone. */
  push(step: Step): void {
    this.undos.push(step);
    this.redos = [];
    this.save();
  }

  /** The step to undo, moved to the redo stack — put it back with `restore` if undoing fails. */
  undo(): Step | undefined {
    return this.move(this.undos, this.redos);
  }

  redo(): Step | undefined {
    return this.move(this.redos, this.undos);
  }

  /** Undo the move of a step that could not be written. */
  restore(step: Step, undone: boolean): void {
    (undone ? this.redos : this.undos).pop();
    (undone ? this.undos : this.redos).push(step);
    this.save();
  }

  private move(from: Step[], to: Step[]): Step | undefined {
    const step = from.pop();
    if (step) to.push(step);
    this.save();
    return step;
  }

  private save(): void {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ undos: this.undos.slice(-200), redos: this.redos }));
    } catch {
      // The stacks still work for this page; they just will not survive a reload.
    }
  }
}
