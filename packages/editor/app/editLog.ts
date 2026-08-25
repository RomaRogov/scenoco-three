import type { Edit } from './document.js';

/** One reversible step. `redo` is replaced rather than appended while a drag coalesces. */
interface Step {
  label: string;
  undo: () => void;
  redo: () => void;
}

/**
 * The undo stack, the pending splices, and who to tell when either changes.
 *
 * Split out of `SceneDocument` because they are two objects: one answers *what the document
 * says* — which element built this node, what may be edited, what an attribute reads as — and
 * this one answers *what has changed since it was opened*. They were one class of forty-eight
 * methods, and the half you were reading was never the half you wanted.
 *
 * Every step is a pair of closures the document supplies, so this knows nothing about XML,
 * elements or the live scene: it decides only when a change is recorded, folded into the
 * previous one, or reversed.
 */
export class EditLog {
  private readonly pending: Edit[] = [];
  private readonly undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private readonly listeners = new Set<() => void>();
  private saved = true;

  /** Everything not yet written to disk. */
  get edits(): readonly Edit[] {
    return this.pending;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get isDirty(): boolean {
    return !this.saved;
  }

  /**
   * Record one change.
   *
   * `coalesce` folds it into the previous step when it touches the same thing, so a gizmo drag
   * that produced two hundred edits undoes in one.
   */
  commit(label: string, apply: () => void, revert: () => void, coalesce: boolean): void {
    const previous = this.undoStack[this.undoStack.length - 1];
    apply();
    if (coalesce && previous?.label === label) {
      previous.redo = apply;
    } else {
      this.undoStack.push({ label, undo: revert, redo: apply });
    }
    this.redoStack = [];
    this.saved = false;
    this.emit();
  }

  /** Record a splice with nothing to apply to the live scene — a structural edit. */
  push(edit: Edit, label: string): void {
    this.commit(
      label,
      () => this.pending.push(edit),
      () => this.pending.pop(),
      false,
    );
  }

  /**
   * Queue an attribute write, replacing any pending write to the same attribute.
   *
   * The **last** write to one attribute wins, so a scrubbed number leaves one edit rather than
   * one per pixel — the file is written once, and the diff shows the value that survived.
   */
  replaceAttribute(edit: Extract<Edit, { op: 'setAttribute' }>): void {
    const index = this.pending.findIndex(
      (e) =>
        e.op === 'setAttribute' &&
        e.at.line === edit.at.line &&
        e.at.column === edit.at.column &&
        e.name === edit.name,
    );
    if (index !== -1) this.pending.splice(index, 1);
    this.pending.push(edit);
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    step.undo();
    this.redoStack.push(step);
    this.saved = false;
    this.emit();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    step.redo();
    this.undoStack.push(step);
    this.saved = false;
    this.emit();
  }

  /** The file has been written: nothing is pending and nothing is undoable past this point. */
  clear(): void {
    this.pending.length = 0;
    this.undoStack.length = 0;
    this.redoStack = [];
    this.saved = true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }
}
