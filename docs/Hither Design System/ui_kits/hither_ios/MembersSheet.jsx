/* Hither iOS kit — Members / group sheet (matches live app screens 2 & 3). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const { GroupChip, RolePill, MemberRow, Switch, GlassSurface, Avatar, Button, GatherPointRow } = NS;

  function SheetHeader() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 16px', background: 'rgba(255,255,255,0.10)', borderRadius: 'var(--radius-pill)' }}>
          <span style={{ color: 'var(--text-muted)' }}>🔍</span>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontWeight: 500 }}>搜尋地點</span>
        </div>
        <Avatar emoji="⚽️" color="neutral" size={46} ring={false} />
      </div>
    );
  }

  function SectionTitle({ children, right }) {
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '22px 2px 12px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-display-md)', color: 'var(--text-primary)' }}>{children}</span>
        {right && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', fontWeight: 500 }}>{right}</span>}
      </div>
    );
  }

  function MembersSheet({ onClose, onSetGather }) {
    const [solo, setSolo] = React.useState(false);
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          <StatusBar />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 16px 0' }}>
            <GroupChip name="松山戶" count={4} members={[{emoji:'⚽️',color:'success'},{emoji:'🐑',color:'signal'},{emoji:'🦊',color:'sky'}]} />
            <RolePill label="隊長" />
          </div>
          <div style={{ flex: 1 }} />
          {/* Sheet */}
          <GlassSurface variant="sheet" weight="heavy" style={{ borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0', padding: '10px 20px 26px', maxHeight: '74%', overflowY: 'auto' }}>
            <div onClick={onClose} style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.35)', margin: '2px auto 16px', cursor: 'pointer' }} />
            <SheetHeader />

            <SectionTitle right="免費版上限 4 人">成員 · 4</SectionTitle>

            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-lg)', padding: '4px 14px' }}>
              <MemberRow emoji="⚽️" name="sudjnd" leader status="領隊中" statusTone="success" you />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', borderTop: '1px solid var(--glass-edge)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontWeight: 500 }}>獨自行動</span>
                  <Switch checked={solo} onChange={setSolo} />
                </div>
                <span style={{ color: 'var(--success)', fontWeight: 700, fontFamily: 'var(--font-display)' }}>建立小隊</span>
              </div>
              <MemberRow emoji="🐑" name="小羊" color="signal" status="未出發" time="3 min" distance="273 m" divider />
              <MemberRow emoji="🦊" name="阿福" color="sky" status="未出發" time="4 min" distance="323 m" divider />
              <MemberRow emoji="🐰" name="奇奇" color="plum" status="未出發" time="3 min" distance="243 m" divider />
            </div>

            <SectionTitle>群組代碼</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40, letterSpacing: 2, color: 'var(--text-primary)' }}>4WBNC7</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="success" size="sm" iconLeft="􀈂">分享</Button>
                <Button variant="ghost" size="sm">複製</Button>
              </div>
            </div>

            <SectionTitle>集合點</SectionTitle>
            <GatherPointRow icon="🚩" title="0 個集合點 · 調整順序" trailing={<span style={{ color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-display)' }}>編輯</span>} onClick={onSetGather} />
            <div style={{ height: 12 }} />
            <GatherPointRow icon="📄" tileTone="sky" title="匯入 KML" trailing={<span style={{ color: 'var(--text-muted)', fontSize: 20 }}>›</span>} />
          </GlassSurface>
        </div>
      </div>
    );
  }
  window.MembersSheet = MembersSheet;
})();
