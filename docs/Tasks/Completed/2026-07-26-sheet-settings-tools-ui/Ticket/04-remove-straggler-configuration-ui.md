# 04 — Remove straggler-alert configuration from the UI

**What to build:** Group leaders no longer see obsolete straggler-alert configuration in either Tools or Settings, while automatic straggler detection and alert delivery continue unchanged.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Tools no longer shows the straggler-alert configuration section.
- [ ] Settings no longer shows or wires a deep-link to straggler configuration.
- [ ] UI-only optimistic straggler configuration state and persistence wiring are removed from the map screen.
- [ ] Straggler detection, alert delivery, group data fields, service methods, RPCs, notifications, and migrations remain unchanged.
- [ ] The focused map UI source-contract test asserts the configuration surface and UI-only wiring are absent, existing straggler behavior tests still pass, and the mobile TypeScript typecheck passes.
