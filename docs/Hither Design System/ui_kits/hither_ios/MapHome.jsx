/* Hither iOS kit — Leader map home. Matches the live app's primary view. */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const { GroupChip, RolePill, MapControl, MemberMarker, GlassSurface, Avatar } = NS;
  const members = [{ emoji: '⚽️', color: 'success' }, { emoji: '🐑', color: 'signal' }, { emoji: '🦊', color: 'sky' }];

  function MapHome({ onOpenSheet, onSetGather }) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg>
          {/* member pins scattered on map */}
          <div style={{ position: 'absolute', left: '30%', top: '40%' }}><MemberMarker emoji="🐑" color="signal" size={44} /></div>
          <div style={{ position: 'absolute', left: '58%', top: '52%' }}><MemberMarker emoji="🦊" color="sky" size={44} pulse /></div>
          <div style={{ position: 'absolute', left: '44%', top: '61%' }}><MemberMarker emoji="🐰" color="plum" size={44} /></div>
          <div style={{ position: 'absolute', left: '48%', top: '30%' }}><MemberMarker gather color="signal" size={50} pulse /></div>
        </MapBg>

        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          <StatusBar />
          {/* top floating controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 16px' }}>
            <GroupChip name="松山戶" count={4} members={members} onClick={onOpenSheet} />
            <RolePill label="隊長" />
          </div>

          <div style={{ flex: 1 }} />

          {/* right map controls */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 12px' }}>
            <MapControl items={[{ icon: '⤢' }, { icon: '➤', active: true }]} />
          </div>

          <AppleMapsTag />

          {/* bottom search sheet peek */}
          <div onClick={onOpenSheet} style={{ padding: '0 12px 22px', cursor: 'pointer' }}>
            <GlassSurface variant="pane" weight="heavy" style={{ borderRadius: 'var(--radius-2xl) var(--radius-2xl) 24px 24px', padding: '10px 14px 18px' }}>
              <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.35)', margin: '2px auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 16px', background: 'rgba(255,255,255,0.10)', borderRadius: 'var(--radius-pill)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>🔍</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontWeight: 500 }}>搜尋地點</span>
                </div>
                <Avatar emoji="⚽️" color="neutral" size={46} ring={false} />
              </div>
            </GlassSurface>
          </div>
        </div>
      </div>
    );
  }
  window.MapHome = MapHome;
})();
