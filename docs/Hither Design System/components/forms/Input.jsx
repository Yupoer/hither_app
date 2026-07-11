import React from 'react';

/**
 * Text input on dark surface. Rounded, roomy tap target, sky focus ring.
 */
export function Input({ value, onChange, placeholder = '', iconLeft = null, type = 'text', style = {}, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        height: 'var(--h-input)', padding: '0 16px',
        background: 'var(--surface-input)', borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${focus ? 'var(--sky-500)' : 'transparent'}`,
        boxShadow: focus ? 'var(--ring-focus)' : 'none',
        transition: 'border var(--dur-fast), box-shadow var(--dur-fast)',
        ...style,
      }}
    >
      {iconLeft && <span style={{ color: 'var(--text-muted)', fontSize: '18px', display: 'inline-flex' }}>{iconLeft}</span>}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-body)', fontWeight: 'var(--fw-medium)',
        }}
        {...rest}
      />
    </div>
  );
}
