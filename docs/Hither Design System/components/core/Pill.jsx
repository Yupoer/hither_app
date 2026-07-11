import React from 'react';

/**
 * Small rounded label / status chip. Solid or soft (tinted) fill.
 * Used for roles (Leader/Follower), status (Arrived, En route), counts.
 */
export function Pill({ children, color = 'signal', soft = false, style = {}, ...rest }) {
  const map = {
    signal: '255,107,53', sky: '55,182,255', pink: '255,68,196',
    cyan: '51,224,214', success: '61,220,132', sun: '255,216,77', neutral: '150,155,163',
  };
  const rgb = map[color] || map.signal;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 12px', borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-bold)',
        fontSize: 'var(--text-footnote)', letterSpacing: '0.01em', lineHeight: 1,
        color: soft ? `rgb(${rgb})` : '#0A0A0C',
        background: soft ? `rgba(${rgb},0.16)` : `rgb(${rgb})`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
