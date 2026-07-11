/* Hither iOS kit — Onboarding (Duolingo-style warmth, Apple-clean structure). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const { Button, ProgressDots, GlassSurface, MemberMarker } = NS;

  const STEPS = [
    { hero: '🐑', beacon: true, title: '把走散的夥伴\n重新聚在一起', body: '你就是牧羊人。規劃路線、設定集合點，讓每個人都知道往哪走。' },
    { hero: '🚩', beacon: false, title: '一秒設定\n下一個集合點', body: '在地圖上點一下，所有隊員立即收到方向與距離。' },
    { hero: '🧭', beacon: false, title: '還差多遠？\n一眼就知道', body: '每位隊員都看得到直線距離與預估步行時間。不再走丟。' },
  ];

  function Onboarding({ onDone }) {
    const [step, setStep] = React.useState(0);
    const s = STEPS[step];
    const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : onDone());
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 80% at 50% 0%, #23305c 0%, var(--bg-app) 60%)', display: 'flex', flexDirection: 'column' }}>
        <StatusBar />
        {/* hero */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 34px', textAlign: 'center' }}>
          <div style={{ position: 'relative', marginBottom: 40 }}>
            <div style={{ fontSize: 108, lineHeight: 1, filter: 'drop-shadow(0 12px 30px rgba(0,0,0,0.5))' }}>{s.hero}</div>
            {s.beacon && <div style={{ position: 'absolute', right: -18, top: -10 }}><MemberMarker gather color="signal" size={46} pulse /></div>}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, lineHeight: 1.12, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-line' }}>{s.title}</h1>
          <p style={{ fontFamily: 'var(--font-ui)', fontWeight: 500, fontSize: 16, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: 18, maxWidth: 300 }}>{s.body}</p>
        </div>
        {/* footer */}
        <div style={{ padding: '0 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <ProgressDots total={STEPS.length} active={step} />
          <Button variant="primary" full onClick={next}>{step < STEPS.length - 1 ? '繼續' : '開始使用'}</Button>
        </div>
      </div>
    );
  }
  window.Onboarding = Onboarding;
})();
