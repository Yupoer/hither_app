import * as React from 'react';

/**
 * GroupChip — floating glass pill with overlapping member avatars, group name,
 * and member count (top-left of the map).
 * @startingPoint section="Hither" subtitle="Group glass pill with avatar stack" viewport="700x150"
 */
export interface GroupChipMember { emoji?: string; label?: string; color?: string; }
export interface GroupChipProps {
  name?: string;
  count?: number;
  members?: GroupChipMember[];
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function GroupChip(props: GroupChipProps): JSX.Element;
