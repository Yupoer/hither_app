import * as React from 'react';

/** MapControl — vertical glass capsule of stacked round icon controls. */
export interface MapControlItem { icon: React.ReactNode; onClick?: () => void; active?: boolean; }
export interface MapControlProps {
  items: MapControlItem[];
  style?: React.CSSProperties;
}
export function MapControl(props: MapControlProps): JSX.Element;
