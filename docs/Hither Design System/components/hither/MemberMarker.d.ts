import * as React from 'react';

/**
 * MemberMarker — a map marker (teardrop pin) for a person or the gather point.
 */
export interface MemberMarkerProps {
  emoji?: string;
  label?: string;
  /** @default "pink" */
  color?: 'signal' | 'sky' | 'pink' | 'cyan' | 'success' | 'sun' | 'plum' | 'neutral';
  /** @default 48 */
  size?: number;
  /** Live locating halo. @default false */
  pulse?: boolean;
  /** Destination beacon variant (flag). @default false */
  gather?: boolean;
  style?: React.CSSProperties;
}
export function MemberMarker(props: MemberMarkerProps): JSX.Element;
