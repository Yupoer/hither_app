import * as React from 'react';

/** Inline banner / callout strip with icon slot. */
export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  /** @default "signal" */
  tone?: 'signal' | 'sky' | 'success' | 'neutral';
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Banner(props: BannerProps): JSX.Element;
