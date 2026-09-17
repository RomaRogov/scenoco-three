import { Plus, Trash2, X } from 'lucide-react';
import type { DocumentShape } from '@scenoco-three/compiler';
import type { ConfigDocument, ConfigNode } from '../config.js';
import type { Scalar } from '../values.js';
import { getDeps, useUI } from './store.js';
import { cx } from './cx.js';
import { HeadBtn } from './HeadBtn.js';
import { PropRow, Section } from './rows.js';
import styles from './ui.module.css';

/**
 * A document that is one value, as a form.
 *
 * Everything drawn here comes from the shape the build read out of the declaring package's own
 * TypeScript and left in the model: the root element's name, the attributes it takes, the child
 * elements it may hold and what each of those takes in turn. Nothing in this file knows what kind
 * of document it is showing — add a package that declares one and it draws that instead.
 *
 * A child element is either written or not, and adding one is the only structural move there is;
 * a repeatable one can be added more than once. That is the whole of the interaction, because
 * that is the whole of what the format allows.
 */
export function ConfigSheet(): React.JSX.Element | null {
  useUI((s) => s.rev);
  const config = getDeps().getConfig();
  if (!config) return null;

  return (
    <div className={cx(styles.sheet, styles.sheetInspector)}>
      <div className={styles.head}>
        <span className={styles.title}>{config.path.split('/').pop()}</span>
        <div className={styles.actions}>
          <HeadBtn label="Close" onClick={() => close(config)}>
            <X />
          </HeadBtn>
        </div>
      </div>
      <div className={styles.body}>
        <Body config={config} />
      </div>
    </div>
  );
}

/**
 * Back to the open dialog.
 *
 * This sheet *is* the document — closing it is closing the file, not hiding a panel — so it asks
 * first when there is something unsaved, which is the one thing a reload would throw away.
 */
function close(config: ConfigDocument): void {
  if (config.isDirty && !confirm('Close without saving? The changes you made will be lost.')) return;
  location.assign(location.pathname);
}

function Body({ config }: { config: ConfigDocument }): React.JSX.Element {
  const root = config.root;
  if (!root) {
    return (
      <div className={styles.inspector}>
        <div className={styles.empty}>{config.problem ?? 'Nothing to show.'}</div>
      </div>
    );
  }
  return (
    <div className={styles.inspector}>
      <Element config={config} node={root} title={root.name} />
    </div>
  );
}

/**
 * One element: its attributes, then the elements it may hold.
 *
 * A group field takes one child, so it is offered once and removable; a list field takes as many
 * as the document writes, so each is its own section and one more can always be added.
 */
function Element({
  config,
  node,
  title,
  onRemove,
}: {
  config: ConfigDocument;
  node: ConfigNode;
  title: string;
  onRemove?: () => void;
}): React.JSX.Element {
  const written = node.shape.fields.filter((f) => config.value(node, f) !== undefined);
  const rest = node.shape.fields.filter((f) => config.value(node, f) === undefined);

  return (
    <Section
      title={title}
      description={node.shape.description}
      actions={
        onRemove ? (
          <HeadBtn label={`Remove <${node.name}>`} onClick={onRemove}>
            <Trash2 />
          </HeadBtn>
        ) : undefined
      }
    >
      {[...written, ...rest].map((prop) => (
        <PropRow
          key={prop.name}
          prop={prop}
          written={config.value(node, prop)}
          editable
          commit={(value: Scalar, opts?: { coalesce?: boolean }) => config.setValue(node, prop, value, opts)}
          clear={() => config.setValue(node, prop, null)}
        />
      ))}
      {Object.entries(node.shape.groups).map(([field, shape]) => (
        <Group key={field} config={config} node={node} shape={shape} repeatable={false} />
      ))}
      {Object.entries(node.shape.lists).map(([field, shape]) => (
        <Group key={field} config={config} node={node} shape={shape} repeatable />
      ))}
    </Section>
  );
}

/** A field that holds elements: what the document writes for it, and a way to write one more. */
function Group({
  config,
  node,
  shape,
  repeatable,
}: {
  config: ConfigDocument;
  node: ConfigNode;
  shape: DocumentShape;
  repeatable: boolean;
}): React.JSX.Element {
  const children = config.childrenOf(node, shape);
  return (
    <>
      {children.map((child, index) => (
        <Element
          key={`${shape.name}:${child.at ? `${child.at.line}:${child.at.column}` : `+${index}`}`}
          config={config}
          node={child}
          title={repeatable ? `${shape.name} ${index + 1}` : shape.name}
          onRemove={() => config.remove(child)}
        />
      ))}
      {repeatable || children.length === 0 ? (
        <button type="button" className={styles.addRow} onClick={() => config.add(node, shape)}>
          <Plus />
          {children.length === 0 ? `Add <${shape.name}>` : `Add another <${shape.name}>`}
        </button>
      ) : null}
    </>
  );
}
