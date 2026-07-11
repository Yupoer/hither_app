import * as React from 'react';

/**
 * Circular member avatar with a bold colored ring (the "smiley marker" motif).
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  emoji?: string | null;
  src?: string | null;
  /** @default "pink" */
  color?: 'signal' | 'sky' | 'pink' | 'cyan' | 'success' | 'sun' | 'neutral';
  /** Diameter px. @default 44 */
  size?: number;
  ring?: boolean;
  /** Offline / lost — desaturated. @default false */
  dimmed?: boolean;
  /** Adds a star badge (the shepherd/leader). @default false */
  leader?: boolean;
  style?: React.CSSProperties;
}
export function Avatar(props: AvatarProps): JSX.Element;
