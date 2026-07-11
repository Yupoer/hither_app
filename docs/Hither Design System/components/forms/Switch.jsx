import React from 'react';

/**
 * iOS-style toggle switch. On = Signal Orange. Springy thumb.
 */
export function Switch({ checked = false, onChange = () => {}, disabled = false, style = {} }) {
  return (
    <button
      role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 52, height: 32, borderRadius: 'var(--radius-pill)', border: 'none',
        background: checked ? 'var(--signal-500)' : 'var(--ink-600)',
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0, opacity: disabled ? 0.5 : 1,
        transition: 'background var(--dur-base) var(--ease-out)',
        boxShadow: checked ? 'var(--glow-signal)' : 'none',
        ...style,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 26, height: 26, borderRadius: '50%', background: '#fff',
        boxShadow: '0 2px 5px rgba(0,0,0,0.4)',
        transition: 'left var(--dur-base) var(--ease-spring)',
      }} />
    </button>
  );
}
