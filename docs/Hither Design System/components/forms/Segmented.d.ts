import * as React from 'react';

/** Segmented control with a sliding accent highlight. */
export interface SegmentedProps {
  /** Strings, or { label, value } objects. */
  options: Array<string | { label: string; value: string }>;
  value: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}
export function Segmented(props: SegmentedProps): JSX.Element;
