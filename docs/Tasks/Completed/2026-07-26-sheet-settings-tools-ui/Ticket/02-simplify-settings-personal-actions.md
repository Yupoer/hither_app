# 02 — Simplify personal and group actions in Settings

**What to build:** Settings gives a group member one clear Return to home action and places the consistently named Leave group action beside the member's personal settings, without changing membership or destructive confirmation semantics.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The personal section shows one Return to home row instead of separate Switch group and Create or join group rows.
- [ ] Tapping Return to home uses the existing home reset flow to show the create/join screen while preserving current group membership.
- [ ] Group management appears in the personal section and no longer appears as a separate section at the bottom of Settings.
- [ ] The visible group-management title is Leave group for both leaders and members.
- [ ] Tapping Leave group retains the existing role-dependent confirmation and leave/end-group callback; confirmation copy and backend behavior do not change.
- [ ] Language, appearance, notifications, custom quick commands, support, account, OTA, diagnostics, sign-out, and reset-preferences actions remain available.
- [ ] The focused map UI source-contract test covers the row count, placement, labels, and callback wiring, and the mobile TypeScript typecheck passes.
