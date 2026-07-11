import * as React from 'react';

/** Rounded dark surface card — the primary opaque container. */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  /** Colored attention glow. */
  glow?: 'signal' | 'sky' | 'pink' | 'success' | null;
  /** px or CSS string. @default 20 */
  padding?: number | string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
