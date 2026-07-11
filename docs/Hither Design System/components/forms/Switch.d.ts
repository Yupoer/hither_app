import * as React from 'react';

/** iOS-style toggle switch (on = accent). */
export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export function Switch(props: SwitchProps): JSX.Element;
