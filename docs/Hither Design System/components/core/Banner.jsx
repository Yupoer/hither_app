import React from 'react';

/**
 * Inline banner / callout strip. Playful tinted background with an icon slot.
 * Used for tips ("回転して撮影"-style hints), status, and the Duolingo-y nudges.
 */
export function Banner({ children, icon = null, tone = 'signal', style = {}, ...rest }) {
  const map = {
    signal: '255,107,53', sky: '55,182,255', success: '61,220,132', neutral: '150,155,163',
  };
  const rgb = map[tone] || map.signal;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 16px', borderRadius: 'var(--radius-md)',
        background: `rgba(${rgb},0.14)`,
        color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-callout)', fontWeight: 'var(--fw-medium)',
        ...style,
      }}
      {...rest}
    >
      {icon && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          background: `rgb(${rgb})`, color: '#0A0A0C', fontSize: '17px',
        }}>{icon}</span>
      )}
      <span style={{ lineHeight: 'var(--lh-normal)' }}>{children}</span>
    </div>
  );
}
