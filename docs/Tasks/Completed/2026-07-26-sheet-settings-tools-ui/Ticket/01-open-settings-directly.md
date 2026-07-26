# 01 — Open Settings directly from the sheet

**What to build:** Tapping the sheet more button opens Settings immediately through the existing UI-action flow, without first asking the user to choose from a platform menu.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Tapping the sheet more button opens the existing Settings overlay in one action on iOS and Android.
- [ ] This entry point no longer presents an iOS action sheet or Android alert menu.
- [ ] The change does not add a navigation route or alter the other ways Settings closes or opens nested overlays.
- [ ] The focused map UI source-contract test covers the direct Settings transition, and the mobile TypeScript typecheck passes.
