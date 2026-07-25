# OTA-03 組織者例外處理中心 Spec

## Problem Statement

Leader 平常只需要知道全隊目前集合點與行程階段；但晚到、求助、掉隊、定位失效、停止分享、離線或疑似強制結束等事件散落在成員列表、快捷指令、navigation state 與 arrival management。現在沒有統一的例外清單、排序、去重或結案狀態，Leader 需要自行拼湊情況。

## Solution

建立以成員與目前集合點為上下文的例外處理中心。將既有事件收斂為去重後的 exception items，依嚴重度與新鮮度排序，顯示原因、最後時間、可用處理動作與處理狀態。正常移動、travel mode 與一般 ETA 不進入清單。

## User Stories

1. As a leader, I want to see only actionable exceptions, so that normal movement does not create noise.
2. As a leader, I want late, help, straggler, location-disabled, sharing-disabled, offline, and force-quit-suspected events in one list, so that I can react from one place.
3. As a leader, I want repeated signals from the same root cause deduplicated, so that one incident does not look like many incidents.
4. As a leader, I want exceptions ordered by severity and freshness, so that urgent problems are handled first.
5. As a leader, I want to mark an exception handled, so that the list reflects my current workload.
6. As a group member, I want my personal travel mode and approximate ETA excluded from exceptions, so that normal individual movement is not treated as a problem.
7. As a leader, I want the exception item to link back to the relevant member and gathering point, so that I can understand context before acting.

## Implementation Decisions

- The exception center is a derived view over existing navigation, location, arrival, permission, and connectivity events; it is not a second source of truth for those events.
- Exception types are `late`, `needs_help`, `straggler`, `location_disabled`, `sharing_disabled`, `offline`, and `force_quit_suspected`.
- Each item includes member, current gathering point, root-cause key, first seen, last seen, severity, status, and available action.
- The same root-cause key for the same member and gathering session is deduplicated or updated in place.
- `open`, `acknowledged`, and `resolved` are handling states; resolving an item does not fabricate a member arrival or change the team phase.
- Normal travel mode, ETA drift, and ordinary progress are never exceptions.
- The Leader is the primary operator; members may emit responses or signals but do not close another member's exception.

## Testing Decisions

- Test each exception source produces one normalized item with the correct context.
- Test repeated source events update one item rather than creating duplicates.
- Test ordering by severity, then freshness, and stable ordering for ties.
- Test acknowledgement and resolution survive refresh and realtime updates.
- Test normal travel mode, ETA changes, and progress do not create items.
- Test an exception being resolved does not alter team phase or another member's personal state.
- Reuse existing navigation, location permission, offline, straggler, arrival, and realtime contract tests.

## Out of Scope

- Automatic intervention or contacting emergency services.
- Replacing the existing notification transport.
- Treating every late ETA fluctuation as an exception.
- A general analytics dashboard or historical incident reporting system.

## Further Notes

The exception center should remain quiet during normal group movement. Its value is the reduction of Leader cognitive load, not the collection of every telemetry event.
