import React from 'react';

/**
 * MapControl — vertical glass capsule holding stacked round icon controls
 * (fullscreen, recenter/compass), like the live app's lower-right controls.
 * Pass an array of { icon, onClick, active } items.
 */
export function MapControl({ items = [], style = {} }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', width: 52,
        background: 'var(--glass-fill)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-edge)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)', overflow: 'hidden', ...style,
      }}
    >
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ height: 1, background: 'var(--glass-edge)', margin: '0 8px' }} />}
          <button
            onClick={it.onClick}
            style={{
              height: 52, border: 'none', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: it.active ? 'var(--accent)' : 'var(--text-primary)', fontSize: 20,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {it.icon}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
