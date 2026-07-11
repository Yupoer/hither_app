/* Hither iOS kit — Set gather point (leader drops the next beacon). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const { GlassSurface, Button, MemberMarker, Input, Banner, IconButton } = NS;

  function SetGatherPoint({ onCancel, onConfirm }) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg />
        {/* centered beacon being placed */}
        <div style={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%,-100%)' }}>
          <MemberMarker gather color="signal" size={60} pulse />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
          <StatusBar />
          <div style={{ padding: '4px 16px' }}>
            <GlassSurface variant="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px' }}>
              <IconButton tone="glass" size={30} onClick={onCancel}>‹</IconButton>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }}>設定集合點</span>
            </GlassSurface>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '0 12px 22px' }}>
            <GlassSurface variant="sheet" weight="heavy" style={{ borderRadius: 'var(--radius-2xl)', padding: 20 }}>
              <Banner tone="signal" icon="🚩" style={{ marginBottom: 16 }}>拖動地圖，把大頭針對準集合地點</Banner>
              <Input iconLeft="📍" placeholder="幫這個集合點取個名字（例如：正門口）" style={{ marginBottom: 16 }} />
              <div style={{ display: 'flex', gap: 12 }}>
                <Button variant="ghost" full onClick={onCancel}>取消</Button>
                <Button variant="primary" full onClick={onConfirm} iconLeft="🚩">通知所有隊員</Button>
              </div>
            </GlassSurface>
          </div>
        </div>
      </div>
    );
  }
  window.SetGatherPoint = SetGatherPoint;
})();
