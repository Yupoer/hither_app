import * as React from 'react';

/** Circular icon button for map controls, +, bell, close. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Diameter in px. @default 44 */
  size?: number;
  /** @default "neutral" */
  tone?: 'neutral' | 'signal' | 'sky' | 'glass';
  disabled?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function IconButton(props: IconButtonProps): JSX.Element;
