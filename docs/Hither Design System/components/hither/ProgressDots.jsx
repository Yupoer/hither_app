import React from 'react';

/**
 * ProgressDots — onboarding step indicator (Duolingo-style). The active step is
 * a stretched accent capsule; the rest are muted dots.
 */
export function ProgressDots({ total = 4, active = 0, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      {Array.from({ length: total }).map((_, i) => {
        const on = i === active;
        const done = i < active;
        return (
          <span key={i} style={{
            height: 8, width: on ? 26 : 8, borderRadius: 'var(--radius-pill)',
            background: on ? 'var(--accent)' : done ? 'var(--accent-press)' : 'var(--ink-600)',
            boxShadow: on ? 'var(--glow-accent)' : 'none',
            transition: 'width var(--dur-base) var(--ease-spring), background var(--dur-base)',
          }} />
        );
      })}
    </div>
  );
}
