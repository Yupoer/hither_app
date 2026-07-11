import * as React from 'react';

/** DistanceChip — walking time + straight-line distance readout. */
export interface DistanceChipProps {
  /** @default "3 min" */
  time?: string;
  /** @default "273 m" */
  distance?: string;
  /** @default "md" */
  size?: 'md' | 'lg';
  /** @default "default" */
  tone?: 'default' | 'accent';
  /** @default "stack" */
  layout?: 'stack' | 'inline';
  style?: React.CSSProperties;
}
export function DistanceChip(props: DistanceChipProps): JSX.Element;
