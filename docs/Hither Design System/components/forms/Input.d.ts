import * as React from 'react';

/** Text input on dark surface with sky focus ring. */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  iconLeft?: React.ReactNode;
  type?: string;
  style?: React.CSSProperties;
}
export function Input(props: InputProps): JSX.Element;
