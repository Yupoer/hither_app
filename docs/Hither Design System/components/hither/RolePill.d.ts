import * as React from 'react';

/** RolePill — floating glass status pill with a colored dot + role label. */
export interface RolePillProps {
  /** @default "隊長" */
  label?: string;
  /** CSS color for the status dot. @default grass green */
  dotColor?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function RolePill(props: RolePillProps): JSX.Element;
