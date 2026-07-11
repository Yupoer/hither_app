import React from 'react';

/**
 * Rounded dark surface card — the primary container in Hither.
 * Optional accent glow to promote a card to "active / attention".
 */
export function Card({ children, elevated = false, glow = null, padding = 20, style = {}, ...rest }) {
  const glows = {
    signal: 'var(--glow-signal)', sky: 'var(--glow-sky)',
    pink: 'var(--glow-pink)', success: 'var(--glow-success)',
  };
  return (
    <div
      style={{
        background: elevated ? 'var(--surface-card-elevated)' : 'var(--surface-card)',
        borderRadius: 'var(--radius-lg)',
        padding: typeof padding === 'number' ? `${padding}px` : padding,
        boxShadow: glow ? glows[glow] : 'var(--shadow-card)',
        color: 'var(--text-primary)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
