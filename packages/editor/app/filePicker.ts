/** A scene/prefab the picker can open (mirrors the server's `/@scenoco/files`). */
interface PickableFile {
  file: string;
  kind: 'scene' | 'prefab';
}

/**
 * The start-up open dialog: shown when the editor is opened with no `?file=`.
 * Lists the scenes/prefabs the server found under the project's assets/ folder
 * and resolves with the one the user picks. It's a modal overlay — the viewport
 * behind it is empty until a file is chosen.
 */
export async function showFilePicker(onPick: (file: string) => void): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'sc-picker';
  const panel = document.createElement('div');
  panel.className = 'sc-picker-panel';
  overlay.append(panel);

  const title = document.createElement('div');
  title.className = 'sc-picker-title';
  title.textContent = 'Open a scene';
  panel.append(title);

  const list = document.createElement('div');
  list.className = 'sc-picker-list';
  list.textContent = 'Scanning assets…';
  panel.append(list);
  document.body.append(overlay);

  let files: PickableFile[] = [];
  try {
    const res = await fetch('/@scenoco/files');
    files = ((await res.json()) as { files: PickableFile[] }).files ?? [];
  } catch {
    /* handled by the empty branch below */
  }

  list.textContent = '';
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sc-picker-empty';
    empty.textContent = 'No .scene.xml or .prefab.xml files found under assets/.';
    list.append(empty);
    return;
  }

  for (const f of files) {
    const row = document.createElement('button');
    row.className = 'sc-picker-row';
    const name = document.createElement('span');
    name.className = 'sc-picker-name';
    name.textContent = f.file;
    const kind = document.createElement('span');
    kind.className = 'sc-picker-kind';
    kind.textContent = f.kind;
    row.append(name, kind);
    row.onclick = () => {
      overlay.remove();
      onPick(f.file);
    };
    list.append(row);
  }
}
