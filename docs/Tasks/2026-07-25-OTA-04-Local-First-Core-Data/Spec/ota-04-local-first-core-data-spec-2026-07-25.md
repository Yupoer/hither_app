# OTA-04 Local-first 核心資料 Spec

## Problem Statement

目前 SQLite 只承擔 location outbox、diagnostics 與 performance 資料；旅團、itinerary、集合點狀態與個人回應仍依賴 Supabase 或記憶體。離線冷啟動無法可靠讀取核心旅程，也沒有一套可重試、去重、衝突可見的核心 mutation 同步機制。

## Solution

把第一批核心資料納入 SQLite：group snapshot、itinerary、active gathering state 與 navigation response。所有讀取先從本地資料庫取得；離線 mutation 寫入 operation outbox，連線後以 idempotent、versioned operation 同步 Supabase，並把 conflict result 回寫本地供 UI 顯示。

## User Stories

1. As a trip member, I want to open the trip while offline, so that I can still see the last known group and itinerary.
2. As a trip member, I want to change an allowed local state while offline, so that the action is not lost when connectivity returns.
3. As a trip member, I want my pending action to retry safely, so that reconnecting does not create duplicates.
4. As a trip member, I want to see whether an action synced, is pending, or conflicted, so that stale data is not mistaken for current truth.
5. As a leader, I want the active gathering state to converge across devices, so that local-first does not create competing team states.
6. As a developer, I want a versioned operation protocol, so that future Nearby transport can reuse the same local mutation contract.

## Implementation Decisions

- SQLite is the device read/write source for the first batch of group snapshot, itinerary, active gathering state, and navigation responses.
- Supabase remains the remote authoritative sync service when connected; local data includes freshness and sync metadata.
- Every mutation has an operation id, entity version, retry state, and conflict result.
- Outbox writes are transactional with the local optimistic state update.
- Replays are idempotent; the server rejects stale versions with a structured conflict result rather than silently overwriting.
- The active gathering state follows OTA-01 semantics: global `staying`／`en_route` and point `pending`／`en_route`／`completed`.
- The first batch does not require Nearby Connections; transport replacement is a later task.

## Testing Decisions

- Test cold start with no network using a previously synchronized snapshot.
- Test offline read, offline mutation, reconnect, retry, duplicate replay, and stale-version conflict.
- Test process termination between local transaction and network submission.
- Test convergence of active gathering state across two clients after ordered and out-of-order updates.
- Test that personal navigation response remains user-scoped and is not merged into team state.
- Reuse existing SQLite outbox, realtime patch, navigation state, and conflict contract tests.

## Out of Scope

- Making every existing table local-first in one release.
- Nearby Connections transport implementation.
- Offline delivery of remote push or other members' live GPS updates.
- Automatic conflict resolution that silently chooses a user's response.

## Further Notes

The operation protocol should be transport-neutral so that Supabase Realtime and a future Nearby spike can carry the same semantic mutation without duplicating domain rules.
