# OTA-07 被動同行者模式 Spec

## Problem Statement

被動同行者通常只需要知道現在集合點、目前階段、下一站與自己的抵達進度，不需要操作完整旅團流程。現有介面沒有低操作負擔的顯示模式，也沒有可靠的回到完整介面入口；但 overlay 與「簡化現有 UI」兩種方案尚未定案。

## Solution

先保留同一個 navigation tree 與同一份全隊／個人狀態，在現有介面上提供可切換的簡易呈現模式。簡易模式顯示行程播報與個人進度，並固定提供切回完整介面的入口。第一張 ticket 先完成方案決策與可驗收邊界，第二張 ticket 再實作決定後的最小模式。

## User Stories

1. As a passive companion, I want to see the current gathering point and its phase, so that I know what the group is doing without navigating the full app.
2. As a passive companion, I want to see the next stop and a coarse personal progress indicator, so that I know what to expect.
3. As a passive companion, I want to open external navigation or request help, so that the few actions I may need remain reachable.
4. As a passive companion, I want to return to the full interface at any time, so that I am never trapped in the simplified mode.
5. As a leader, I want passive companions to receive the same team gathering state, so that the simplified view does not create a second source of truth.
6. As a passive companion, I want my local display preference remembered, so that the app opens in the mode I chose on this device.
7. As a user, I do not want the app to infer consent, payment, voting, or safety approval from passive mode or silence.

## Implementation Decisions

- OTA-07 is a presentation mode, not a second app flow or a second state model.
- The product decision must choose between a true overlay and a reduced existing screen before implementation begins.
- The mode must read the same global gathering phase and the same user-scoped progress as the full interface.
- The minimum display includes current gathering point, global phase, next point, coarse ETA/progress, external navigation, help, and a persistent switch-back action.
- Location, movement, arrival, and progress may be automatically inferred; announcement responses, votes, payments, and safety consent may not.
- The preference is local to the device unless a later decision explicitly requires cross-device sync.

## Testing Decisions

- Test entering and leaving passive mode from every primary screen.
- Test that team state changes appear identically in full and passive presentation.
- Test that the switch-back action remains available after loading, empty data, stale data, and an error state.
- Test that personal progress remains user-scoped and is not written into team state.
- Test that no implicit consent, payment, vote, or safety action is emitted by entering or remaining in passive mode.
- Prefer existing navigation, gathering-state, and accessibility contract tests.

## Out of Scope

- A separate navigation hierarchy or duplicate data store.
- Automatic consent, voting, payment, or safety confirmation.
- Cross-device synchronization of the display preference.
- A pixel-identical design for every platform.

## Further Notes

OTA-07 remains a product decision item. If the overlay is rejected, the implementation ticket should be reduced to a presentation simplification inside the existing screen rather than creating a new shell.
