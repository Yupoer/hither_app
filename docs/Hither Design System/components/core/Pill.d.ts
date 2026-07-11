import * as React from 'react';

/** Small rounded status / label chip. */
export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** @default "signal" */
  color?: 'signal' | 'sky' | 'pink' | 'cyan' | 'success' | 'sun' | 'neutral';
  /** Tinted (soft) fill instead of solid. @default false */
  soft?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Pill(props: PillProps): JSX.Element;
