import { useEffect, useState } from 'react';
import { getDeps, useUI } from './store.js';
import styles from './ui.module.css';

/** A document the picker offers — the scenes and prefabs the server found in the project. */
interface Pickable {
  kind: string;
  /** Project-relative path, which is what `open` takes. */
  path: string;
  /** File name without its kind suffix — `main` from `main.scene.xml`. */
  stem: string;
}

/** Only these two are a thing to *open*: the rest are referenced by path from inside one. */
const OPENABLE = new Set(['scene', 'prefab']);

/**
 * The start-up open dialog, shown whenever no document is open — which is what a bare
 * `scenoco-editor` means.
 *
 * Opening the first scene it happened to find instead would be a guess, and a wrong one in any
 * project with more than one scene: the editor would come up on something the person has to
 * navigate away from, with no way to see what else there is.
 */
export function FilePicker(): React.JSX.Element | null {
  useUI((s) => s.rev); // an open (or a failed one) changes whether this shows at all
  const { getDoc, listDocuments, openDocument } = getDeps();
  const [files, setFiles] = useState<Pickable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const open = getDoc() !== undefined;

  useEffect(() => {
    if (open) return;
    let live = true;
    void listDocuments().then(
      (all) => live && setFiles(all.filter((f) => OPENABLE.has(f.kind))),
      () => live && setFiles([]),
    );
    return () => {
      live = false;
    };
  }, [open, listDocuments]);

  if (open) return null;

  const pick = (file: Pickable): void => {
    setFailed(null);
    void openDocument(file.path).catch((error: unknown) =>
      setFailed(error instanceof Error ? error.message : String(error)),
    );
  };

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.title}>Open a document</span>
        </div>
        <div className={styles.modalList}>
          {files === null ? (
            <div className={styles.empty}>Scanning the project…</div>
          ) : files.length === 0 ? (
            <div className={styles.empty}>No .scene.xml or .prefab.xml documents in this project.</div>
          ) : (
            files.map((file) => (
              <button key={file.path} type="button" className={styles.modalItem} onClick={() => pick(file)}>
                <span className={styles.modalItemTag}>
                  {file.stem}
                  <span className={styles.pickKind}>{file.kind}</span>
                </span>
                <span className={styles.modalItemDesc}>{file.path}</span>
              </button>
            ))
          )}
          {failed !== null && <div className={styles.empty}>{failed}</div>}
        </div>
      </div>
    </div>
  );
}
