import React from 'react';

/**
 * MemberMarker — a map marker for a person: a colored teardrop pin holding an
 * emoji/initial, with a white ring so it pops on the basemap. `pulse` adds a
 * live locating halo. Use `gather` for the destination beacon variant.
 */
export function MemberMarker({ emoji, label, color = 'pink', size = 48, pulse = false, gather = false, style = {} }) {
  const map = {
    signal: '#FF6B35', sky: '#37B6FF', pink: '#FF44C4', cyan: '#33E0D6',
    success: '#4ADE80', sun: '#FFD84D', plum: '#A97BFF', neutral: '#6C737F',
  };
  const c = gather ? 'var(--accent)' : (map[color] || map.pink);
  const cRaw = gather ? '255,107,53' : ({ signal:'255,107,53', sky:'55,182,255', pink:'255,68,196', cyan:'51,224,214', success:'74,222,128', sun:'255,216,77', plum:'169,123,255', neutral:'108,115,127' }[color] || '255,68,196');
  return (
    <div style={{ position: 'relative', width: size, height: size, ...style }}>
      {pulse && (
        <span style={{
          position: 'absolute', left: '50%', top: '50%', width: size * 1.9, height: size * 1.9,
          transform: 'translate(-50%,-50%)', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${cRaw},0.35) 0%, rgba(${cRaw},0) 70%)`,
        }} />
      )}
      <div style={{
        position: 'relative', width: size, height: size, borderRadius: '50% 50% 50% 4px',
        transform: 'rotate(45deg)', background: c,
        border: '3px solid #fff', boxShadow: `0 4px 14px rgba(0,0,0,0.45), 0 0 18px rgba(${cRaw},0.5)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ transform: 'rotate(-45deg)', fontSize: size * 0.5, lineHeight: 1, fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-bold)', color: '#0A0A0C' }}>
          {gather ? '🚩' : emoji || (label ? label.slice(0, 1) : '')}
        </span>
      </div>
    </div>
  );
}
