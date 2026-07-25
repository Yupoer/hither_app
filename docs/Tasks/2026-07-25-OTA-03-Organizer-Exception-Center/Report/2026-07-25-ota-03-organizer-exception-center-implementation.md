# Implementation Report: OTA-03 Organizer Exception Center

> Date: 2026-07-25  
> Status: **Code + unit tests shipped**  
> Audience: code reviewers

## 1. Summary

Leader 例外處理中心以**純衍生 view**收斂既有來源：navigation member technical state、membership offline、straggler 距離、`need_help` 指令、集合時間逾期 late、以及可選的 navigation response（OTA-02 對齊）。不另建後端 exception 表；處理狀態（open / acknowledged / resolved）存在本機 AsyncStorage，**不會**改寫 team phase、arrival 或他人 personal state。

## 2. Delivered

| Acceptance | How |
|---|---|
| 七種 exception type | `utils/organizerExceptions.ts` 正規化 |
| member + gathering + root-cause + first/last + severity + status | `OrganizerExceptionItem` |
| 同 member/session/root cause 去重更新 | `dedupeExceptionCandidates` + prior firstSeen |
| severity → freshness → stable key 排序 | `sortOrganizerExceptions` |
| acknowledge / resolve | `transitionExceptionHandling` + AsyncStorage store + Map overlay actions |
| 正常 progress 不進清單 | `exceptionTypeFromNavStatus` 排除 tracking/arriving/arrived 等 |

## 3. Files

| File | Role |
|---|---|
| `apps/mobile/src/utils/organizerExceptions.ts` | Pure normalize / dedupe / sort / late-from-meetAt |
| `apps/mobile/src/state/exceptionHandlingStore.ts` | Local handling persistence |
| `apps/mobile/src/state/useOrganizerExceptions.ts` | Leader hook: sources + list + markHandled |
| `apps/mobile/src/api/services/NavigationService.ts` | `listNavigationMemberStates`, `subscribeSessionMemberStates` |
| `apps/mobile/src/screens/MapScreen.tsx` | Leader entry row + exceptions OverlaySheet |
| `apps/mobile/src/i18n/index.ts` | zh/en exception copy |
| `apps/mobile/src/__tests__/organizerExceptions.test.ts` | 16 unit tests |

## 4. Design decisions

1. **Derived only** — no new Supabase tables; handling is device-local so it survives refresh without inventing server incident history.
2. **Session-scoped root cause** — `nav:{sessionId}` preferred, else `dest:{destinationId}`, else `group:{groupId}`.
3. **permission_denied → location_disabled** — same actionable root cause for the leader.
4. **Resolved hidden by default** — workload list stays quiet; `includeResolved` for tests / future UI.
5. **Late without OTA-02** — meetAt overdue + not arrived; also accepts explicit `navigationResponses` when OTA-02 lands.
6. **needs_help** — realtime `commands` INSERT type `need_help` + optional response field.

## 5. Tests

```
npx jest src/__tests__/organizerExceptions.test.ts
# 16 passed
```

## 6. Not claimed

- Cross-device shared handling state (would need backend).
- Auto-intervention / emergency contact.
- Historical incident analytics dashboard.
