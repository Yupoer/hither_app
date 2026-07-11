/* Hither iOS kit — Follower navigation view (which way, how far). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const { GlassSurface, RolePill, GroupChip, MemberMarker, DistanceChip, Button } = NS;

  function FollowerNav({ onOpenSheet }) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg>
          {/* dashed path from you to the gather beacon */}
          <svg viewBox="0 0 390 700" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <path d="M195 470 C 210 380, 170 320, 200 250" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 16" opacity="0.9" />
          </svg>
          <div style={{ position: 'absolute', left: '50%', top: '34%', transform: 'translate(-50%,-100%)' }}><MemberMarker gather color="signal" size={52} pulse /></div>
          <div style={{ position: 'absolute', left: '50%', top: '66%', transform: 'translate(-50%,-50%)' }}><MemberMarker emoji="🦊" color="sky" size={50} pulse /></div>
        </MapBg>

        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          <StatusBar />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 16px' }}>
            <GroupChip name="松山戶" count={4} members={[{emoji:'⚽️',color:'success'},{emoji:'🐑',color:'signal'},{emoji:'🦊',color:'sky'}]} onClick={onOpenSheet} />
            <RolePill label="隊員" dotColor="var(--sky-500)" />
          </div>
          <div style={{ flex: 1 }} />
          {/* big directional readout */}
          <div style={{ padding: '0 12px 22px' }}>
            <GlassSurface variant="sheet" weight="heavy" tint={null} style={{ borderRadius: 'var(--radius-2xl)', padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 46, transform: 'rotate(-20deg)' }}>➤</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>前往集合點 · 正門口</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 44, color: 'var(--accent)', lineHeight: 1 }}>4 min</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--text-muted)' }}>· 323 m</span>
                  </div>
                </div>
              </div>
              <Button variant="primary" full style={{ marginTop: 18 }} iconLeft="🧭">開始導航</Button>
            </GlassSurface>
          </div>
        </div>
      </div>
    );
  }
  window.FollowerNav = FollowerNav;
})();
