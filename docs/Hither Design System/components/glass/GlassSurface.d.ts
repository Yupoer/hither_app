import * as React from 'react';

/**
 * GlassSurface — the foundational Liquid Glass material slab (blur + translucent
 * fill + specular edge + sheen). Everything floating over the map builds on it.
 */
export interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @default "pane" */
  variant?: 'pane' | 'pill' | 'sheet' | 'capsule';
  /** Blur/opacity intensity. @default "regular" */
  weight?: 'regular' | 'thin' | 'heavy';
  /** Themed glass tint. @default null */
  tint?: 'accent' | 'sky' | 'success' | null;
  /** Show the diagonal specular sheen. @default true */
  sheen?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function GlassSurface(props: GlassSurfaceProps): JSX.Element;
