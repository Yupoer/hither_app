import React from 'react';

/**
 * GlassSurface — the foundational Liquid Glass material slab.
 * Everything that floats over the map (chips, capsules, sheets, popovers) is
 * built on this. Handles blur, translucent fill, specular edge + sheen, shadow.
 *
 * variant: 'pane' (default rounded card) | 'pill' | 'sheet' | 'capsule'
 * weight:  'regular' | 'thin' | 'heavy'   (blur/opacity intensity)
 * tint:    null | 'accent' | 'sky' | 'success'   (themed glass)
 */
export function GlassSurface({
  children,
  variant = 'pane',
  weight = 'regular',
  tint = null,
  sheen = true,
  style = {},
  ...rest
}) {
  const blur = { regular: 'var(--glass-blur)', thin: 'var(--glass-blur-thin)', heavy: 'var(--glass-blur-strong)' }[weight];
  const fill = tint
    ? { accent: 'var(--glass-fill-accent)', sky: 'rgba(55,182,255,0.20)', success: 'rgba(74,222,128,0.20)' }[tint]
    : { regular: 'var(--glass-fill)', thin: 'var(--glass-fill-light)', heavy: 'var(--glass-fill-heavy)' }[weight];
  const radius = {
    pane: 'var(--radius-lg)', pill: 'var(--radius-pill)',
    sheet: 'var(--radius-2xl) var(--radius-2xl) 0 0', capsule: 'var(--radius-xl)',
  }[variant];
  const shadow = variant === 'sheet' ? 'var(--glass-shadow-sheet)' : 'var(--glass-shadow)';

  return (
    <div
      style={{
        position: 'relative', isolation: 'isolate',
        background: fill,
        backdropFilter: blur, WebkitBackdropFilter: blur,
        border: '1px solid var(--glass-edge)',
        borderRadius: radius,
        boxShadow: `${shadow}, var(--glass-inner-hi), var(--glass-inner-lo)`,
        color: 'var(--text-primary)',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {sheen && (
        <span aria-hidden style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          background: 'var(--glass-sheen)', pointerEvents: 'none', zIndex: 0,
        }} />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}
