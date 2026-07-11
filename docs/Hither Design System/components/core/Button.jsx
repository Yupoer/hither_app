import React from 'react';

/**
 * Hither primary action button. Chunky, pill-shaped, springy on press.
 * Variants: primary (Signal Orange), secondary (Electric Sky), ghost, success.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'lg',
  full = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}) {
  const palettes = {
    primary: { bg: 'var(--signal-500)', bgHover: 'var(--signal-400)', fg: 'var(--on-accent)', glow: 'var(--glow-signal)' },
    secondary: { bg: 'var(--sky-500)', bgHover: 'var(--sky-400)', fg: '#04263B', glow: 'var(--glow-sky)' },
    success: { bg: 'var(--meadow-500)', bgHover: 'var(--meadow-400)', fg: '#043318', glow: 'var(--glow-success)' },
    ghost: { bg: 'var(--surface-input)', bgHover: 'var(--ink-600)', fg: 'var(--text-primary)', glow: 'none' },
    glass: { bg: 'var(--glass-fill)', bgHover: 'var(--glass-fill-light)', fg: 'var(--text-primary)', glow: 'none' },
  };
  const p = palettes[variant] || palettes.primary;
  const isGlass = variant === 'glass';
  const sizes = {
    lg: { height: 'var(--h-button)', padding: '0 26px', font: 'var(--text-title)' },
    sm: { height: 'var(--h-button-sm)', padding: '0 18px', font: 'var(--text-callout)' },
  };
  const s = sizes[size] || sizes.lg;

  const [pressed, setPressed] = React.useState(false);
  const [hover, setHover] = React.useState(false);

  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        width: full ? '100%' : 'auto',
        height: s.height, padding: s.padding,
        fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)',
        fontSize: s.font, letterSpacing: '0.01em',
        color: disabled ? 'var(--text-muted)' : p.fg,
        background: disabled ? 'var(--ink-700)' : (hover ? p.bgHover : p.bg),
        backdropFilter: isGlass ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: isGlass ? 'var(--glass-blur)' : 'none',
        border: isGlass ? '1px solid var(--glass-edge)' : 'none',
        borderRadius: 'var(--radius-pill)', cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled || variant === 'ghost' ? 'none' : (isGlass ? 'var(--glass-shadow), var(--glass-inner-hi)' : (hover ? p.glow : '0 2px 10px rgba(0,0,0,0.3)')),
        transform: pressed && !disabled ? 'scale(var(--press-scale))' : 'scale(1)',
        transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
      {...rest}
    >
      {iconLeft && <span style={{ display: 'inline-flex', fontSize: '1.25em' }}>{iconLeft}</span>}
      {children}
      {iconRight && <span style={{ display: 'inline-flex', fontSize: '1.25em' }}>{iconRight}</span>}
    </button>
  );
}
