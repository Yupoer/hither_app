import * as React from 'react';

/** MemberRow — one person in the members list. */
export interface MemberRowProps {
  emoji?: string;
  label?: string;
  name?: string;
  /** @default "sky" */
  color?: string;
  /** @default "未出發" */
  status?: string;
  time?: string | null;
  distance?: string | null;
  /** Marks the current user (shows 你). @default false */
  you?: boolean;
  /** Shepherd/leader treatment (green ring + star). @default false */
  leader?: boolean;
  /** @default "muted" */
  statusTone?: 'muted' | 'success';
  divider?: boolean;
  style?: React.CSSProperties;
}
export function MemberRow(props: MemberRowProps): JSX.Element;
