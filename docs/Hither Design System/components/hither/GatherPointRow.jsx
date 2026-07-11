import React from 'react';

/**
 * GatherPointRow — a list row with a rounded accent icon tile, a title, and an
 * optional trailing action/chevron. Used for gather points, KML import, etc.
 */
export function GatherPointRow({ icon = '🚩', title, trailing = null, tileTone = 'success', onClick, style = {} }) {
  const tiles = {
    success: 'rgba(74,222,128,0.18)', accent: 'rgba(255,107,53,0.18)', sky: 'rgba(55,182,255,0.18)',
  };
  const tileFg = { success: 'var(--grass-500)', accent: 'var(--accent)', sky: 'var(--sky-500)' };
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
        padding: 12, border: '1px solid var(--glass-edge)', background: 'var(--glass-fill)',
        backdropFilter: 'var(--glass-blur-thin)', WebkitBackdropFilter: 'var(--glass-blur-thin)',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...style,
      }}
    >
      <span style={{
        width: 48, height: 48, borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: tiles[tileTone], color: tileFg[tileTone],
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
      }}>{icon}</span>
      <span style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--text-title)', color: 'var(--text-primary)' }}>
        {title}
      </span>
      {trailing}
    </button>
  );
}
