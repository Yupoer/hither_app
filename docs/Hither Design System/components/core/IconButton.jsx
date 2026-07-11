import React from 'react';

/**
 * Circular icon button — used for +, bell, close, and map controls.
 * Sits on dark surfaces as a soft charcoal circle; can be tinted with an accent.
 */
export function IconButton({
  children,
  size = 44,
  tone = 'neutral',
  disabled = false,
  style = {},
  ...rest
}) {
  const tones = {
    neutral: { bg: 'var(--surface-card-elevated)', fg: 'var(--text-primary)' },
    signal: { bg: 'var(--signal-500)', fg: 'var(--on-accent)' },
    sky: { bg: 'var(--sky-500)', fg: '#04263B' },
    glass: { bg: 'rgba(30,32,36,0.72)', fg: 'var(--text-primary)' },
  };
  const t = tones[tone] || tones.neutral;
  const [pressed, setPressed] = React.useState(false);
  return (
    <button
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, minWidth: size,
        borderRadius: 'var(--radius-pill)', border: 'none',
        background: t.bg, color: t.fg, cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: `${Math.round(size * 0.46)}px`,
        backdropFilter: tone === 'glass' ? 'blur(14px)' : 'none',
        transform: pressed ? 'scale(var(--press-scale))' : 'scale(1)',
        transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-base) var(--ease-out)',
        WebkitTapHighlightColor: 'transparent', opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
