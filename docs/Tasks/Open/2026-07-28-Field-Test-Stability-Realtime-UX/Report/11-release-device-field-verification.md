# 11 — Release-like device field verification

**Environment note:** Physical iOS/Android devices were **not** available in this implement session. This document is the executable checklist + residual risk record. Complete on a release-like build before shipping.

## Build identity (fill on device)

| Field | Value |
|-------|-------|
| Date / timezone | |
| iOS device / OS | |
| Android device / OS | |
| Native build number | |
| EAS update id | |
| Runtime version | |
| Tester | |

## Checklist

### A. OTA + team entry (ticket 02)

- [ ] Settings → 立即更新 when update available → single reload into valid UI (not blank).
- [ ] After reload, toast may show once; no native termination attributed to reload alone.
- [ ] 查看我的隊伍 → enter joined team (double-tap) → Map loads; no hang/crash.
- [ ] Leave and re-enter same team → idempotent.

### B. Local personal progress (ticket 04)

- [ ] Walk toward active stop: card distance/ETA, 我的進度, Live Activity update together **without** waiting for peer realtime.
- [ ] Temporary GPS loss: last values retained (no jump to 0 nonsense).
- [ ] Arrival → progress 100% / ETA now; completion does not regress after late sample.

### C. Gathering card (ticket 05)

- [ ] Completed flag has no active glow.
- [ ] Card never shows/leaks「變更已保存，等待連線同步」.
- [ ] Leader all-arrived → defer「先不要完成」→ primary is **完成**, not **開始**.
- [ ] Complete still works after reload / realtime.

### D. Live Activity (ticket 06)

- [ ] Only one activity per session (push-to-start + app start reconciled).
- [ ] Title = gathering point when set.
- [ ] Lock / expanded: distance, ETA, progress, arrived/total.
- [ ] Leading identity = travel mode; no crook + mode duplicate; no icon before「前往集合點」.
- [ ] Compact/minimal degrade without claiming forced expanded.

### E. Target pulse (ticket 07)

- [ ] Only active target pulses ~every 5s briefly.
- [ ] Completed / other stops static.
- [ ] Background / Reduce Motion: no continuous animation; static emphasis ok.

### F. Force refresh (ticket 08)

- [ ] Self marker/timestamp updates immediately.
- [ ] Success: **no** success alert.
- [ ] Cooldown / permission / failure still alert.

### G. Passive mode (ticket 09)

- [ ] Title「被動模式」; enter hint one line.
- [ ] Full quick-command catalogue + custom commands (parity with 全部快捷指令).
- [ ] No implicit consent/payment/vote on enter/exit.

### H. Maps transit (ticket 10)

- [ ] Android Google: transit lines/stations visible where Google has coverage; base map remains if not.
- [ ] iOS MapKit: public-transport POIs present; transit routing still works via directions; no claim of full transit network layer.

### I. Energy / audio (ticket 03)

- [ ] Podcast playing during 30 min navigation smoke (FG + BG + lock).
- [ ] No serious/critical thermal; no Hither-driven audio interruption.
- [ ] Compare to `docs/testflight/navigation-energy-acceptance.md` gates.

## Measurement summary (fill)

| Metric | Baseline | This build | Pass? |
|--------|----------|------------|-------|
| Thermal peak | | | |
| Battery 30 min | | | |
| Frame stalls (notes) | | | |
| Network count (Hither HTTP) | | | |
| Watchdog / crash | | | |
| Audio glitch | | | |

## Residual risk (implement session)

| Risk | Why open |
|------|----------|
| Native OTA/team-entry crash class unconfirmed | No device + no windowed MetricKit pull |
| Google `showsTransit` requires native rebuild | node_modules bridge + next native build |
| Heat under Podcast unmeasured | Device-only |
| Live Activity widget binary | Needs rebuild of live-activity target |

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Implementer | (code complete) | 2026-07-28 | Device blocked |
| Device QA | | | |
