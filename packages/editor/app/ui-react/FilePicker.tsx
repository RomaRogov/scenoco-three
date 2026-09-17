import { useEffect, useState } from 'react';
import { getDeps, useUI } from './store.js';
import styles from './ui.module.css';

/** A document the picker offers. */
interface Pickable {
  kind: string;
  path: string;
  /** File name without its kind suffix — `main` from `main.scene.xml`. */
  stem: string;
  /** Where it is from: the folder's name, or "examples". */
  group?: string;
}

/**
 * The open dialog: two ways in, then a list.
 *
 * A folder, because a scene is never one file — its geometry, materials and prefabs are files
 * beside it, and the folder is what makes them reachable and makes a save possible. Or a URL,
 * with everything the document refers to fetched relative to it. Once a folder is open, every
 * scene and prefab in it is listed; the examples the site carries are offered underneath.
 */
export function FilePicker(): React.JSX.Element | null {
  useUI((s) => s.rev);
  const { getDoc, getConfig, listDocuments, openDocument, actions } = getDeps();
  const [files, setFiles] = useState<Pickable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  // Either kind of document counts as open: a config document has no scene, and the dialog
  // standing over its form was the difference between "opened" and "looks like nothing happened".
  const open = getDoc() !== undefined || getConfig() !== undefined;
  const folder = actions.folder();

  useEffect(() => {
    if (open) return;
    let live = true;
    setFiles(null);
    // Already filtered to what opens: the host knows the project's kinds, this does not.
    void listDocuments().then(
      (all) => live && setFiles(all),
      () => live && setFiles([]),
    );
    return () => {
      live = false;
    };
  }, [open, listDocuments, folder]);

  if (open) return null;

  const attempt = (action: () => Promise<void>): void => {
    setFailed(null);
    void action().catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)));
  };
  const pick = (file: Pickable): void => attempt(() => openDocument(file.path));
  const own = files?.filter((f) => folder !== null && f.group === folder) ?? [];
  const examples = files?.filter((f) => f.group === 'examples' || (f.group !== undefined && f.group !== folder)) ?? [];

  const row = (file: Pickable): React.JSX.Element => (
    <button key={`${file.group ?? ''}:${file.path}`} type="button" className={styles.modalItem} onClick={() => pick(file)}>
      <span className={styles.modalItemTag}>
        {file.stem}
        <span className={styles.pickKind}>{file.kind}</span>
        {file.group && file.group !== folder && <span className={styles.pickKind}>{file.group}</span>}
      </span>
      <span className={styles.modalItemDesc}>{file.path}</span>
    </button>
  );

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <span className={styles.title}>{folder ? `Open a document in ${folder}` : 'Open a scene'}</span>
        </div>
        <div className={styles.modalList}>
          {!folder && (
            <>
              <button type="button" className={styles.modalItem} onClick={() => attempt(actions.openFolder)}>
                <span className={styles.modalItemTag}>Open a folder…</span>
                <span className={styles.modalItemDesc}>
                  a project on this machine: every scene and prefab in it, with saves back to disk (Chrome, Edge)
                </span>
              </button>
              <form
                className={styles.modalItem}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (url.trim()) attempt(() => actions.openUrl(url.trim()));
                }}
              >
                <span className={styles.modalItemTag}>Open a URL…</span>
                <span className={styles.modalItemDesc}>
                  a document on the web; what it refers to is fetched relative to it
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://…/assets/scenes/main.scene.xml"
                    style={{
                      flex: 1,
                      font: 'inherit',
                      padding: '4px 6px',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'inherit',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 4,
                    }}
                  />
                  <button type="submit" className={styles.modalItem} style={{ padding: '4px 12px' }}>
                    Open
                  </button>
                </span>
              </form>
            </>
          )}
          {folder && files !== null && own.length === 0 && (
            <div className={styles.empty}>Nothing to open in this folder.</div>
          )}
          {folder && own.map(row)}
          {examples.length > 0 && (
            <>
              <div className={styles.empty}>{folder ? 'or one of the examples' : 'or try an example'}</div>
              {examples.map(row)}
            </>
          )}
          {files === null && <div className={styles.empty}>Listing…</div>}
          {failed !== null && <div className={styles.empty}>{failed}</div>}
        </div>
      </div>
    </div>
  );
}
