/**
 * The stateful edit primitive. Every mutation in the editor is a `Command` so it
 * can be undone and (because each one also mutates the compiled scene) saved as a
 * diff. Commands are deliberately tiny — `apply` redoes, `invert` undoes.
 */
export interface Command {
  /** Human label (undo menu / debugging). */
  readonly label: string;
  apply(): void;
  invert(): void;
  /**
   * Edits sharing a key, applied back-to-back, collapse into a single undo step.
   * A gizmo drag or a numeric scrub emits one command per frame; undo should
   * rewind the whole gesture, not each intermediate value.
   */
  readonly coalesceKey?: string;
}

/** Undo/redo history with same-key coalescing. `onChange` fires after every mutation. */
export class UndoStack {
  private readonly undoables: Command[] = [];
  private readonly redoables: Command[] = [];

  constructor(private readonly onChange?: () => void) {}

  /** Apply a command and record it, merging into the previous one if keys match. */
  run(cmd: Command): void {
    cmd.apply();
    const prev = this.undoables[this.undoables.length - 1];
    if (cmd.coalesceKey !== undefined && prev?.coalesceKey === cmd.coalesceKey) {
      // Adopt the latest `apply` (current value) but keep the earliest `invert`
      // (the pre-gesture state), so one undo rewinds the entire gesture.
      this.undoables[this.undoables.length - 1] = {
        label: prev.label,
        coalesceKey: prev.coalesceKey,
        apply: cmd.apply,
        invert: prev.invert,
      };
    } else {
      this.undoables.push(cmd);
    }
    this.redoables.length = 0;
    this.onChange?.();
  }

  undo(): void {
    const cmd = this.undoables.pop();
    if (!cmd) return;
    cmd.invert();
    this.redoables.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoables.pop();
    if (!cmd) return;
    cmd.apply();
    this.undoables.push(cmd);
    this.onChange?.();
  }

  get canUndo(): boolean {
    return this.undoables.length > 0;
  }
  get canRedo(): boolean {
    return this.redoables.length > 0;
  }

  clear(): void {
    this.undoables.length = 0;
    this.redoables.length = 0;
    this.onChange?.();
  }
}
