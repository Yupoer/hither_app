/* Hither iOS kit — shared frame + basemap helpers. Exposed on window. */
const { useState } = React;

function StatusBar({ dark = false }) {
  const c = dark ? '#0A0A0C' : '#fff';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 26px 6px', fontFamily: 'var(--font-ui)', color: c,
      fontWeight: 700, fontSize: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>14:40</span>
        <span style={{ fontSize: 13 }}>➤</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15 }}>
        <span>▂▄▆</span>
        <span>􀙇</span>
        <span style={{
          border: `2px solid ${c}`, borderRadius: 5, padding: '1px 4px',
          fontSize: 11, fontWeight: 800,
        }}>99</span>
      </div>
    </div>
  );
}

/* Apple-Maps-style dark navy basemap with faint islands + a POI + member pins */
function MapBg({ children, style = {} }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'radial-gradient(130% 100% at 25% 8%, #1e386b 0%, #16264a 42%, #101b36 100%)',
      overflow: 'hidden', ...style,
    }}>
      {/* faint landmasses */}
      <svg viewBox="0 0 390 700" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
        <path d="M120 470 q40 -30 90 -10 q50 20 70 5 q30 -22 -5 -45 q-60 -25 -120 0 q-55 25 -35 55z" fill="#22c55e" opacity="0.28"/>
        <path d="M40 520 q20 -12 45 -4 q10 20 -12 26 q-40 6 -33 -22z" fill="#22c55e" opacity="0.2"/>
        <path d="M260 430 q22 -14 40 -2 q8 18 -14 24 q-34 4 -26 -22z" fill="#22c55e" opacity="0.22"/>
      </svg>
      <span style={{ position: 'absolute', left: '52%', top: '66%', fontFamily: 'var(--font-ui)', color: '#8fb98f', fontSize: 12, fontWeight: 600 }}>🌲 西表石垣國立公園</span>
      <span style={{ position: 'absolute', right: '10%', top: '58%', fontFamily: 'var(--font-ui)', color: '#6a7fae', fontSize: 15, fontWeight: 700, letterSpacing: 4, transform: 'rotate(-18deg)' }}>先島群島</span>
      {children}
    </div>
  );
}

function AppleMapsTag() {
  return (
    <div style={{ position: 'absolute', left: 20, bottom: 138, display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}>
       Maps <span style={{ fontWeight: 500, fontSize: 12, textDecoration: 'underline', color: 'rgba(255,255,255,0.5)' }}>Legal</span>
    </div>
  );
}

/* iPhone frame — rounded screen, notch, home indicator */
function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 390, height: 844, borderRadius: 54, background: '#000',
      padding: 5, boxShadow: '0 40px 90px rgba(0,0,0,0.55)', position: 'relative',
      flexShrink: 0,
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 49, overflow: 'hidden',
        position: 'relative', background: 'var(--bg-app)',
      }}>
        {children}
        <div style={{
          position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
          width: 134, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.6)', zIndex: 50,
        }} />
      </div>
    </div>
  );
}

Object.assign(window, { StatusBar, MapBg, AppleMapsTag, PhoneFrame });
