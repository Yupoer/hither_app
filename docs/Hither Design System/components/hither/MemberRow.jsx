import React from 'react';
import { Avatar } from '../core/Avatar.jsx';
import { DistanceChip } from './DistanceChip.jsx';

/**
 * MemberRow — one person in the members list: avatar, name, status line, and a
 * trailing time/distance readout. `you` and `leader` add the accent treatments.
 */
export function MemberRow({
  emoji, label, name, color = 'sky', status = '未出發',
  time = null, distance = null, you = false, leader = false,
  statusTone = 'muted', divider = false, style = {},
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px',
      borderTop: divider ? '1px solid var(--glass-edge)' : 'none', ...style,
    }}>
      <Avatar emoji={emoji} label={label || name} color={leader ? 'success' : color} size={46} ring leader={leader} dimmed={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--text-title)', color: 'var(--text-primary)' }}>
          {name}
        </div>
        <div style={{
          fontSize: 'var(--text-footnote)', fontWeight: 'var(--fw-medium)', marginTop: 2,
          color: statusTone === 'success' ? 'var(--success)' : 'var(--text-muted)',
        }}>
          {status}
        </div>
      </div>
      {you
        ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-callout)', fontWeight: 'var(--fw-medium)' }}>你</span>
        : (time && <DistanceChip time={time} distance={distance} size="md" />)}
    </div>
  );
}
