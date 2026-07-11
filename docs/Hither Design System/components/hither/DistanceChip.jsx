import React from 'react';

/**
 * DistanceChip — the twin readout of walking time + straight-line distance to a
 * gather point. Core to Hither's "which way, how far" answer. Two sizes.
 * layout: 'stack' (time over distance, right-aligned) | 'inline'
 */
export function DistanceChip({ time = '3 min', distance = '273 m', size = 'md', tone = 'default', layout = 'stack', style = {} }) {
  const timeColor = tone === 'accent' ? 'var(--accent)' : 'var(--text-primary)';
  const timeSize = size === 'lg' ? 'var(--text-display-sm)' : 'var(--text-title)';
  if (layout === 'inline') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, ...style }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-bold)', fontSize: timeSize, color: timeColor }}>{time}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--text-footnote)' }}>{distance}</span>
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, ...style }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-bold)', fontSize: timeSize, color: timeColor, lineHeight: 1 }}>{time}</span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--text-footnote)' }}>{distance}</span>
    </div>
  );
}
