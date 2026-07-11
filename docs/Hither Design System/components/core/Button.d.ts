import * as React from 'react';

/**
 * Primary action button — chunky, pill-shaped, springy on press.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: 'primary' | 'secondary' | 'success' | 'ghost' | 'glass';
  /** @default "lg" */
  size?: 'lg' | 'sm';
  /** Stretch to container width. @default false */
  full?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
