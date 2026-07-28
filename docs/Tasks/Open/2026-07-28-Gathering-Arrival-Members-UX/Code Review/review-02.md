# Code Review — Gathering Arrival Members UX (2026-07-28)

**Reviewer:** Codex
**Review type:** Working-tree review
**Base:** `HEAD` (`b50d6791d878f85a791ce23d71c69e55640bb6bb`)
**Diff:** `git diff HEAD -- apps/mobile`
**Spec:** `Spec/gathering-arrival-members-ux-spec-2026-07-28.md`

## Verdict

**Request changes.** Focused tests and TypeScript pass, but the implementation has three P1 correctness issues in auto-completion and three P2 behaviour gaps.

## Standards

No documented-standard hard violation was found in `CLAUDE.md` or `apps/mobile/README.md`.

The following are judgement-call smell findings:

- **[P2] Duplicated Code** — `apps/mobile/src/utils/gatherCommand.ts:202-218,300-324` keeps Chinese prompt/button copy and `cancelLabel`/`deferLabel`, while `apps/mobile/src/i18n/index.ts:559-565` and `apps/mobile/src/screens/MapScreen.tsx:2384-2406` maintain the same user-facing semantics. A future copy change must be synchronized in three places.
- **[P3] Speculative Generality** — `apps/mobile/src/utils/gatherCommand.ts:213-218,303-324` retains deprecated `deferLabel`, although production callers now use `cancelLabel` and the only fallback was added in this change.
- **[P3] Speculative Generality / Middle Man** — `apps/mobile/src/native/externalNavigation.ts:116-124` exports `defaultMapsProviderForPlatform`, but production code and tests do not call it; the new flow always uses the chooser.
- **[P3] Duplicated Code** — `apps/mobile/src/__tests__/targetMarkerPulse.test.ts:62-70,80-88` repeats the same `fs`/`path`/`GroupMap.tsx` setup.

## Spec

- **[P1] Remote final arrival does not auto-complete**

  `apps/mobile/src/screens/MapScreen.tsx:2457-2460` only schedules `promptCompleteAfterArrival` from the local personal-arrival path. The manual button at `:4654-4657` is the other entry point. A Realtime/database update where another member becomes the final arrival does not trigger the leader's complete-stop path.

  Spec requirement: when `arrivedCount === totalCount` and `totalCount > 0`, immediately run the existing complete-stop path without confirmation.

- **[P1] Arrival counts are not scoped to the destination**

  `apps/mobile/src/screens/MapScreen.tsx:2349-2353` derives `totalCount` and missing members from `members`, but the spec requires current scoped members. The arrival UI already filters by `destination.subgroupId` at `:5265-5267`. For subgroup stops, unrelated members are counted as missing, producing incorrect x/x copy and preventing auto-completion.

  Spec requirement: derive `arrivedCount` and `totalCount` from current scoped members and destination arrivals.

- **[P1] Auto-complete can run before the arrival write succeeds**

  `apps/mobile/src/screens/MapScreen.tsx:2528-2535` calls `afterPersonalArrivalRef.current(...)` before awaiting `setDestinationArrivalAt(...)`. The callback schedules completion at `:2457-2460`, and the prompt forcibly adds the current user to the arrived set at `:2347-2348`. If the arrival RPC fails, the timeout is still active and `complete_gathering_stop` can close the stop even though the arrival was rolled back.

  Spec requirement: the arrival path records the current time and applies completion rules after the arrival write succeeds.

- **[P2] iOS notification path does not match the spec**

  `apps/mobile/src/screens/MapScreen.tsx:2370-2376` always calls `scheduleLocalNotification`, including on iOS. The spec calls for APNs or the existing push path on iOS, with local notification as the Android fallback for this event.

- **[P2] External-map failures are silently swallowed**

  `apps/mobile/src/native/externalNavigation.ts:103-109` catches both provider open failures with `catch(() => undefined)`. If the selected app or URL cannot open, the user receives neither a failure message nor a fallback, contrary to the spec's explicit failure/fallback requirement.

- **[P2] Member pull/rebind failures are hidden**

  `apps/mobile/src/screens/MapScreen.tsx:1954-1962` starts `refresh()` with `void` and swallows its rejection. The spinner can finish before the roster has rebound, and a failed pull is reported as a successful refresh. The spec requires push → pull → local roster rebind, with failures remaining visible.

## Verification

- Focused Jest: 7 suites, 99 tests passed.
- TypeScript: `npm.cmd run typecheck` passed.
- Device smoke testing was not performed.

