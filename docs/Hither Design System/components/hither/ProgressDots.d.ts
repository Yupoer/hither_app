import * as React from 'react';

/** ProgressDots — onboarding step indicator (active step = stretched capsule). */
export interface ProgressDotsProps {
  total?: number;
  active?: number;
  style?: React.CSSProperties;
}
export function ProgressDots(props: ProgressDotsProps): JSX.Element;
