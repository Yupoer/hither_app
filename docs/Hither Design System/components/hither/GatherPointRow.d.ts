import * as React from 'react';

/** GatherPointRow — list row with accent icon tile + title + trailing action. */
export interface GatherPointRowProps {
  /** @default "🚩" */
  icon?: React.ReactNode;
  title?: string;
  trailing?: React.ReactNode;
  /** @default "success" */
  tileTone?: 'success' | 'accent' | 'sky';
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function GatherPointRow(props: GatherPointRowProps): JSX.Element;
