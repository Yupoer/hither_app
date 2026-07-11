import React from 'react';

/**
 * RolePill — floating glass status pill (top-right): a colored status dot plus
 * the current role ("隊長" / Leader, "隊員" / Follower). Green dot = live/tracking.
 */
export function RolePill({ label = '隊長', dotColor = 'var(--grass-500)', onClick, style = {} }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        height: 46, padding: '0 18px', border: '1px solid var(--glass-edge)',
        background: 'var(--glass-fill)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
        borderRadius: 'var(--radius-pill)', boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...style,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--text-title)', color: 'var(--text-primary)' }}>
        {label}
      </span>
    </button>
  );
}
