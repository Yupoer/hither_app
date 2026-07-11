import React from 'react';

/**
 * Circular member avatar with a bold colored ring — the "smiley marker" motif.
 * Each member gets a role color. Ring signals presence; dimmed = offline/lost.
 * Supports emoji, initials, or image.
 */
export function Avatar({
  label = '',
  emoji = null,
  src = null,
  color = 'pink',
  size = 44,
  ring = true,
  dimmed = false,
  leader = false,
  style = {},
  ...rest
}) {
  const map = {
    signal: '#FF6B35', sky: '#37B6FF', pink: '#FF44C4',
    cyan: '#33E0D6', success: '#3DDC84', sun: '#FFD84D', neutral: '#6B7078',
  };
  const ringColor = dimmed ? 'var(--ink-600)' : (map[color] || map.pink);
  const initials = label ? label.trim().slice(0, 2).toUpperCase() : '';
  return (
    <div
      title={label}
      style={{
        position: 'relative', width: size, height: size, minWidth: size,
        borderRadius: 'var(--radius-pill)',
        background: dimmed ? 'var(--ink-700)' : (map[color] || map.pink),
        border: ring ? `${Math.max(2, size * 0.06)}px solid ${ringColor}` : 'none',
        boxShadow: ring && !dimmed ? `0 0 0 2px var(--bg-app), 0 4px 12px rgba(0,0,0,0.4)` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', opacity: dimmed ? 0.6 : 1,
        color: '#0A0A0C', fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-bold)',
        fontSize: `${Math.round(size * 0.4)}px`,
        ...style,
      }}
      {...rest}
    >
      {src ? <img src={src} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : emoji ? <span style={{ fontSize: `${Math.round(size * 0.5)}px` }}>{emoji}</span>
        : initials}
      {leader && (
        <span style={{
          position: 'absolute', top: -6, right: -6, width: size * 0.42, height: size * 0.42,
          borderRadius: '50%', background: 'var(--sun-500)', border: '2px solid var(--bg-app)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.26,
        }}>★</span>
      )}
    </div>
  );
}
