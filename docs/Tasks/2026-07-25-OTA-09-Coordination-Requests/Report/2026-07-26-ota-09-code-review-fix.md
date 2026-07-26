# Report: OTA-09 Code Review Fix

> Date: 2026-07-26  
> Status: **Code review P1 addressed** (pending re-review)  
> Source: `Code Review/2026-07-26-ota-09-code-review.md`

## 1. Summary

Fixed the P1 that blocked OTA-09: coordination request lifecycle existed only as backend/service — **no user-facing flow**.

MapScreen now exposes a reachable list / detail / create surface wired to `CoordinationRequestService`, with refresh (realtime + poll) and **no coupling to navigation start**.

## 2. Findings → delivery

| Finding | Severity | Fix |
|---|---|---|
| Lifecycle only in service; no screen/hook/MapScreen caller | P1 | Hook + panel + MapScreen route-tab entry; tests for wiring and nav independence |

## 3. User path

1. Open a non-demo group on **MapScreen**
2. Bottom sheet → **路線 (Route)** tab
3. Tap **協調請求 / Coordination** (`testID="map-open-coordination"`)
4. Overlay (`OverlaySheet`) shows:

| Mode | Capability |
|---|---|
| List | Subject, status, response count, deadline, resolved outcome |
| Detail | Participant selects option (changeable while open); silence remains valid |
| Leader | Create (subject, 2 options, policy, 30‑min deadline); force-close override; cancel |

5. Pull-to-refresh; realtime on `coordination_requests` / `coordination_responses` + 45s poll  
6. **Navigation start unchanged** — `useJourneyNavigation` does not depend on coordination state

Demo groups: coordination disabled (`enabled: !isDemoGroup`).

## 4. Files

| Path | Change |
|---|---|
| `apps/mobile/src/screens/MapScreen/hooks/useCoordinationRequests.ts` | **New** — fetch/create/respond/override/cancel + realtime + poll |
| `apps/mobile/src/screens/MapScreen/components/CoordinationRequestsPanel.tsx` | **New** — list / detail / create UI |
| `apps/mobile/src/screens/MapScreen.tsx` | Wire hook + route-pane entry + overlay |
| `apps/mobile/src/i18n/index.ts` | zh/en `coordination.*` strings |
| `apps/mobile/src/__tests__/useCoordinationRequests.test.ts` | **New** — hook integration |
| `apps/mobile/src/__tests__/coordinationRequestUiContract.test.ts` | **New** — MapScreen/panel/nav independence contracts |
| `apps/mobile/src/state/backgroundJourney.ts` | Unrelated pre-existing type narrowing so typecheck passes |

Existing (unchanged product backend):

- `apps/mobile/src/api/services/CoordinationRequestService.ts`
- `supabase/migrations/20260725090000_coordination_requests.sql`

## 5. Verification

| Command | Result |
|---|---|
| `npm run typecheck` (apps/mobile) | Pass |
| `jest` on `useCoordinationRequests` + `coordinationRequestUiContract` + `coordinationRequestContract` | Pass (25 tests in agent run) |

Note: full RN component tree render suite (`jest.config.components.js`) was not used (preset issue). Coverage is hook integration + source contracts.

## 6. Residual risks

1. **Minimal create UX** — free-text subject + two option labels; no destination picker / map pin wiring for option payloads.
2. List load may N+1 fetch responses per request (acceptable for small groups).
3. Realtime subscription on responses is table-wide (not `group_id` filtered) — may extra-refresh on other groups.
4. Product polish (empty states, deep links, push) left for later OTA polish if needed.

## 7. Re-review checklist

- [ ] Route tab shows Coordination entry for non-demo groups
- [ ] Organizer can create request and see response count / deadline
- [ ] Participant can respond with an option before deadline
- [ ] Leader override / cancel / resolved outcome visible
- [ ] Start navigation still works while a request is open
- [ ] Demo group does not enable coordination hook
