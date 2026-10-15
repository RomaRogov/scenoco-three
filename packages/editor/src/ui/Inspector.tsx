/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { ListTree, X } from 'lucide-react';
import type { Inspected, Row } from '../controller.js';
import { useController, useUI } from './store.js';
import { HeadBtn, Section, Sheet } from './parts.js';
import { BoolRow, ColorRow, LockRow, NumberRow, TextRow, VecRow } from './fields.js';

const DEG = 180 / Math.PI;

/**
 * The selection's transform, its element's attributes, what it is built from and every behaviour
 * on it. A value the file writes can be cleared; one it does not shows its default, dimmed, and
 * writing it puts it in the file.
 */
export function InspectorSheet(): React.JSX.Element | null {
  const { inspectorOpen, selected, closeInspector, openNodes } = useUI();
  if (!inspectorOpen) return null;
  return (
    <Sheet
      side="right"
      title="Inspector"
      actions={
        <>
          {/* Upright, this sheet covers the node list's launcher: the way across is here. */}
          <HeadBtn label="Node list" onClick={openNodes}>
            <ListTree />
          </HeadBtn>
          <HeadBtn label="Close" onClick={closeInspector}>
            <X />
          </HeadBtn>
        </>
      }
    >
      <div className="se-inspector">{selected ? <Body /> : <div className="se-empty">Select something — tap it in the scene or the node list.</div>}</div>
    </Sheet>
  );
}

function Body(): React.JSX.Element | null {
  const rev = useUI((s) => s.rev);
  const selected = useUI((s) => s.selected);
  const editor = useController();
  const [shown, setShown] = useState<Inspected | null>(null);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    void editor.inspect(selected).then((inspected) => live && setShown(inspected));
    return () => void (live = false);
  }, [selected, rev, editor]);
  if (!shown) return null;
  return (
    <>
      <div className="se-identity">
        <span className="se-identityName">{shown.title}</span>
        {shown.source ? <span className="se-source">{shown.source}</span> : null}
      </div>
      {shown.hint ? <div className="se-hint">{shown.hint}</div> : null}
      {shown.groups.map((group, i) => (
        <Section key={`${i}:${group.title}`} title={group.title}>
          {group.rows.map((row) => (
            <Field key={row.name} row={row} />
          ))}
          {group.hint ? <div className="se-hint">{group.hint}</div> : null}
        </Section>
      ))}
    </>
  );
}

/** A row's widget, chosen by the shape of its value. */
function Field({ row }: { row: Row }): React.JSX.Element {
  const common = { label: row.degrees ? `${row.name} °` : row.name, ...(row.unset ? { unset: true } : {}), ...(row.clear ? { onClear: row.clear } : {}) };
  const { value, commit } = row;
  if (row.locked || !commit) return <LockRow {...common} value={typeof value === 'string' ? value : JSON.stringify(value)} reason={row.locked ?? 'Read only'} />;
  if (typeof value === 'number') return <NumberRow {...common} value={value} commit={commit} />;
  if (typeof value === 'boolean') return <BoolRow {...common} value={value} commit={commit} />;
  if (typeof value === 'string') {
    return /^#[0-9a-f]{6}$/i.test(value) ? <ColorRow {...common} value={value} commit={commit} /> : <TextRow {...common} value={value} commit={commit} />;
  }
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((v) => typeof v === 'number')) {
    // Rotations are radians on the object and in the file, degrees in the widget.
    if (row.degrees) {
      return <VecRow {...common} value={(value as number[]).map((r) => r * DEG)} commit={(next, preview) => commit(next.map((d) => d / DEG), preview)} />;
    }
    return <VecRow {...common} value={value as number[]} commit={commit} />;
  }
  return <LockRow {...common} value={JSON.stringify(value) ?? '—'} reason="No widget edits this value — change it in the file" />;
}
