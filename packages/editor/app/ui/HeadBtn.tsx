import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** An icon button in a sheet header (actions row / close). */
export function HeadBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button className={styles.headBtn} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
