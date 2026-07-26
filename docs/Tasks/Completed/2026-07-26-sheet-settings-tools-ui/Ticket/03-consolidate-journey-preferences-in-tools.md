# 03 — Consolidate journey preferences in Tools

**What to build:** A traveller can configure all current device-level map and journey preferences at the start of Tools, with related controls ordered and presented together instead of duplicated in Settings.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Tools starts with these switches in order: passive companion mode, location sharing, oblique locate, Live Activity, default gathering-card expansion, and gathering-card title marquee.
- [ ] Each switch reuses its existing preference value, setter, switch styling, accessibility state, and location-sharing callback where applicable; no duplicate state or preference store is introduced.
- [ ] The existing marquee speed slider appears immediately after the title-marquee switch only while that switch is enabled.
- [ ] The complete Map & journey section is absent from Settings after the controls move.
- [ ] Existing arrival-radius and quick-command tools remain available after the moved controls.
- [ ] The focused map UI and passive-companion contracts cover ordering, wiring, conditional slider visibility, persistence, and passive presentation, and the mobile TypeScript typecheck passes.
