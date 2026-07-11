import React from 'react';

/**
 * Segmented control — the Leader / Follower role toggle and view switchers.
 * Sliding highlight pill behind the active segment.
 */
export function Segmented({ options = [], value, onChange = () => {}, style = {} }) {
  const idx = Math.max(0, options.findIndex(o => (o.value ?? o) === value));
  return (
    <div
      style={{
        position: 'relative', display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        background: 'var(--surface-input)', borderRadius: 'var(--radius-pill)',
        padding: 4, height: 46, ...style,
      }}
    >
      <span style={{
        position: 'absolute', top: 4, bottom: 4, left: 4,
        width: `calc((100% - 8px) / ${options.length})`,
        transform: `translateX(${idx * 100}%)`,
        background: 'var(--signal-500)', borderRadius: 'var(--radius-pill)',
        boxShadow: 'var(--glow-signal)',
        transition: 'transform var(--dur-base) var(--ease-spring)',
      }} />
      {options.map((o) => {
        const val = o.value ?? o;
        const lbl = o.label ?? o;
        const active = val === value;
        return (
          <button key={val} onClick={() => onChange(val)}
            style={{
              position: 'relative', zIndex: 1, border: 'none', background: 'transparent',
              cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-semibold)',
              fontSize: 'var(--text-callout)',
              color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
              transition: 'color var(--dur-base)',
            }}>
            {lbl}
          </button>
        );
      })}
    </div>
  );
}
