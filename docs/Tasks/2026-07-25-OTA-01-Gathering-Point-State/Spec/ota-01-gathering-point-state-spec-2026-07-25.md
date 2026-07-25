# OTA-01 集合點狀態與行程播報 Spec

## Problem Statement

目前已有 active destination、navigation session 與 itinerary closure，但「開始」、「前往中」、「結束」容易被誤解成三個都可按的按鈕狀態。實際產品只需要兩個可按操作：開始與結束；前往中只是開始後的不可按顯示狀態。開始前與結束後都代表沒有集合點正在前往，即全域停留狀態。

## Solution

採用兩層狀態模型：全域行程 phase 與單一集合點 status。

- 全域 `journeyPhase`：`staying` 或 `en_route`。
- 單一集合點 `pointStatus`：`pending → en_route → completed`。
- `staying` 包含目前集合點尚未開始，以及上一個集合點結束後等待下一點的狀態。
- 只有 `pending` 可顯示可按的「開始」；`en_route` 顯示「前往中」但不可按，並只提供可按的「結束」；`completed` 不再可操作。
- 結束目前集合點並切換到下一個集合點時，上一點保持 `completed`，下一點回到 `pending`／全域 `staying`，直到再次按開始。

## User Stories

1. As a leader, I want one Start action for the pending gathering point, so that the whole group begins from one authoritative event.
2. As a group member, I want to see "前往中" after Start, so that I know the team is travelling without mistaking it for another action.
3. As a leader, I want End to be the only action while travelling, so that a point cannot be started twice or ended before it starts.
4. As a group member, I want the app to show a staying state before Start and after End, so that no point appears to be travelling when none is active.
5. As a group member, I want the finished point to remain completed when the next point is selected, so that itinerary history is not rewritten.
6. As a group member, I want every surface to show the same current point and global phase, so that the map, notification, and passive mode do not disagree.
7. As a group member, I want my travel mode, approximate ETA, location, arrival, and progress to remain personal, so that another member's movement does not alter the team phase.
8. As a leader, I want only the authorized leader/server transition the team state, so that concurrent devices cannot create two active gathering points.

## Implementation Decisions

- Persist `journeyPhase` as `staying | en_route`; do not persist a clickable `started` phase.
- Persist the current point identity, order, point status, phaseChangedAt, and version.
- A point transition is `pending → en_route → completed`; invalid transitions are rejected.
- Start is enabled only for the next pending point while global phase is staying.
- While global phase is en_route, the UI displays `前往中` as disabled and exposes End.
- End marks the active point completed and returns global phase to staying. Selecting the next point does not make it en_route until Start is pressed.
- Only the Leader/server can perform team transitions; all clients render the authoritative result.
- Travel mode, ETA, individual location, arrival, and progress remain user-scoped fields and never update team phase.
- Reuse existing group, navigation session, and itinerary closure paths; do not add a parallel broadcast system.

## Testing Decisions

- Test initial pending point: global staying, Start enabled, no active en-route point.
- Test Start: point becomes en_route, global phase becomes en_route, Start is disabled, End is enabled.
- Test en_route display cannot trigger another Start or duplicate transition.
- Test End: point becomes completed, global phase returns to staying, next point remains pending.
- Test next-point transition and history retention across reload and realtime update.
- Test invalid, duplicate, stale-version, and concurrent transitions are rejected or converge to one result.
- Test that individual travel mode, ETA, arrival, and progress never alter team phase.
- Reuse existing gathering workflow, navigation session, realtime, arrival, and Live Activity contract tests.

## Out of Scope

- Per-person voting to start or end a gathering point.
- Treating travel mode or precise ETA as a team state.
- Automatic completion inferred only from a person's location.
- Replacing the external navigation provider's route calculation.

## Further Notes

The user-visible three-step narrative remains「開始 → 前往中 → 結束」, but the interaction model has only two buttons. 「停留」 is the global no-active-travel state before Start and after End; 「已完成」 is the terminal status of an individual point.
