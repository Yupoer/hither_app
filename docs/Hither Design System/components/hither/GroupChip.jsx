import React from 'react';
import { Avatar } from '../core/Avatar.jsx';

/**
 * GroupChip — floating glass pill (top-left of the map): a stack of overlapping
 * member avatars, the group name, and the member count. Matches the live app.
 */
export function GroupChip({ name = 'Group', count = 0, members = [], onClick, style = {} }) {
  const shown = members.slice(0, 3);
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        height: 46, padding: '0 16px 0 6px', border: '1px solid var(--glass-edge)',
        background: 'var(--glass-fill)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
        borderRadius: 'var(--radius-pill)', boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...style,
      }}
    >
      <span style={{ display: 'inline-flex', paddingLeft: 6 }}>
        {shown.map((m, i) => (
          <span key={i} style={{ marginLeft: i === 0 ? 0 : -12, borderRadius: '50%', boxShadow: '0 0 0 2px var(--glass-fill-heavy)' }}>
            <Avatar emoji={m.emoji} label={m.label} color={m.color} size={30} ring={false} />
          </span>
        ))}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--text-title)', color: 'var(--text-primary)' }}>
        {name}
      </span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--text-callout)' }}>· {count}</span>
    </button>
  );
}
