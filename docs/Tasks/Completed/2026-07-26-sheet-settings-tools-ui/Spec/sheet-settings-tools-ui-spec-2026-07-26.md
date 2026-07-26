## Problem Statement

群組地圖 sheet 的更多按鈕目前先顯示平台 action menu，使用者必須再選一次才能進入設定。設定的個人區同時提供「切換群組」與「創建或加入群組」，但兩者都把使用者帶離目前群組地圖，資訊架構重複；「群組管理」又被放在設定底部，且隊長與一般成員看到不同的動作名稱。

地圖與旅程的裝置偏好目前位於設定，但使用情境更接近 sheet 的工具頁；工具頁同時仍顯示不再需要的脫隊示警設定。成員、路線、工具的主 sheet 三段選擇器則仍使用一般自繪底色，沒有套用專案已存在的 iOS 26 Liquid Glass capability boundary。

## Solution

1. 點擊群組地圖 sheet 的更多按鈕後直接開啟設定，不再顯示 action menu。
2. 設定的個人區只保留一個「回到主畫面」入口，沿用既有回首頁流程；將群組管理移入同一區，且隊長與一般成員都顯示「離開群組」。實際離開／結束群組的確認與後續行為維持不變。
3. 工具頁最上方先顯示被動同行者模式，再依序提供位置分享、斜角定位、即時動態、預設展開集合點卡片、集合點名稱跑馬燈，以及跑馬燈開啟時相鄰顯示的速度控制。設定頁不再重複顯示這些控制。
4. 工具頁保留既有抵達距離與快捷指令功能，但工具頁與設定頁都不再顯示脫隊示警設定。
5. 僅替主 sheet 的成員／路線／工具三段選擇器套用既有 Liquid Glass boundary；保留三選一、滑動指示、鎖定選項與無障礙狀態。iOS 26 以下、Android 與不支援環境沿用既有 fallback。

## User Stories

1. As a group member, I want the sheet's more button to open Settings immediately, so that I can reach preferences in one tap.
2. As a group member, I want the more button to avoid a platform action menu, so that Settings behaves consistently on iOS and Android.
3. As a group member, I want one clearly named Return to home row in Settings, so that I do not have to distinguish between overlapping group-navigation actions.
4. As a group member, I want returning home to preserve my current membership, so that opening the create/join screen does not implicitly leave my group.
5. As a group member, I want group management beside my personal settings, so that membership actions are easy to find.
6. As a group member, I want the group-management action to say Leave group, so that its label is consistent regardless of my role.
7. As a group leader, I want the existing confirmation flow to remain in force after tapping Leave group, so that the renamed row does not silently change destructive behavior.
8. As a traveller, I want passive companion mode to be the first switch in Tools, so that I can enter the simplified presentation quickly.
9. As a group member, I want location sharing in Tools, so that I can control whether this device uploads and retains its location.
10. As a group member, I want oblique locate in Tools, so that I can choose the locate-me camera presentation.
11. As an iOS user, I want Live Activity in Tools, so that I can control lock-screen journey updates.
12. As a group member, I want gathering-card expansion and title marquee preferences in Tools, so that journey presentation controls live together.
13. As a group member, I want marquee speed next to the marquee switch when enabled, so that the relationship between the controls is clear.
14. As a group member, I want existing arrival-radius and quick-command tools to remain available, so that this reorganization does not remove unrelated tools.
15. As a group leader, I want obsolete straggler-alert configuration removed from both Tools and Settings, so that the app no longer exposes that configuration surface.
16. As an iOS 26 user, I want the Members, Route, and Tools selector to use system Liquid Glass material, so that primary sheet navigation matches the platform.
17. As an older iOS or Android user, I want the same three navigation choices to remain functional, so that visual enhancement does not reduce platform parity.
18. As a user relying on accessibility services, I want every segment to retain its label plus selected and disabled state, so that the control remains understandable.

## Implementation Decisions

- The more-button callback directly transitions the existing overlay state to Settings through the current UI-action path. Remove the iOS action sheet and Android alert branches for this entry point; do not add a navigation route.
- Reuse the existing settings row primitive. Replace the separate Switch group and Create or join rows with one Return to home row wired to the current home reset behavior, which preserves membership and returns to the create/join screen.
- Move the existing group-management row into the personal section and always render its visible title as Leave group. Keep the existing role-dependent confirmation and leave/end-group callback unchanged.
- Reuse the existing preference context values, setters, switch styling, accessibility metadata, and location-sharing callback. Do not add another preference store or duplicate local state.
- Place the six map/journey switches at the start of Tools in this order: passive companion mode, location sharing, oblique locate, Live Activity, default gathering-card expansion, and gathering-card title marquee. Show the existing marquee speed slider immediately after the marquee switch only while marquee is enabled.
- Remove the complete Map & journey section from Settings after moving its controls. Keep Settings language, appearance, notifications, custom quick commands, support, account, OTA, diagnostics, sign-out, and reset-preferences behavior unchanged.
- Keep the existing Tools arrival-radius and quick-command sections after the moved preference controls.
- Remove the straggler configuration section, its Settings deep-link, and UI-only optimistic state/persistence wiring from the map screen. Keep straggler detection, alert delivery, group data fields, service methods, RPCs, notifications, and migrations unchanged.
- Apply the existing native glass surface only at the main sheet selector call site, with an opt-in transparent/unstyled segmented track as needed. Do not globally glassify the shared segmented component because Settings also uses it for language, theme, and text size.
- The Members/Route/Tools control remains the existing React Native three-value segmented interaction. A SwiftUI `Toggle` is binary and is not a semantic replacement for this control; no SwiftUI bridge is introduced.
- No database, API, navigation route, dependency, or native target changes are required.

## Testing Decisions

- Use the existing map UI source-contract suite as the primary high-level seam. Assert externally observable composition and wiring: direct Settings opening, one Return to home row, group-management placement and label, Tools ordering, absence of straggler configuration, and main-selector Liquid Glass opt-in.
- Update the existing passive-companion contract only where it currently assumes the switch is rendered in Settings; retain its persistence and presentation assertions.
- Selector coverage must verify all three options still dispatch selection changes and expose selected/disabled accessibility state. Verify the glass wrapper is scoped to the main sheet selector rather than every shared segmented control.
- Run the focused map UI and passive-companion contract tests plus the existing mobile TypeScript typecheck.
- Perform a supported-iOS check for Liquid Glass rendering and one unsupported-platform check for the fallback; source-contract assertions alone cannot prove native material rendering.
- Verify the feature worktree diff against `origin/master`; do not use the dirty orchestration root as a test source.
- Tests should assert visible behavior and callback wiring, not animation internals or component implementation details.

## Out of Scope

- Replacing the three-way selector with a SwiftUI `Toggle`, native segmented picker, or new navigation control.
- Building a new SwiftUI bridge or adding `@expo/ui`/another dependency.
- Removing straggler-alert backend fields, RPCs, notifications, or data migrations.
- Changing leader/member leave semantics, confirmation copy, or backend behavior; this task changes the visible Settings row label only.
- Reordering or redesigning Members, Route, arrival-radius, quick-command, or other unaffected sheet content.
- Redesigning every segmented control in Settings.
- OTA publishing, native builds, App Store submission, or APK release.

## Further Notes

- Apple defines segmented picker semantics for mutually exclusive multi-option selection, while `Toggle` represents binary state. The requested three-way control therefore keeps segmented semantics.
- Expo documents `GlassView` as iOS 26+ native Liquid Glass with unsupported-platform fallback. This project already centralizes that capability check and fallback in one native boundary, which this feature reuses.
- Future risk: leaders still execute the existing end-group confirmation flow even though the Settings row says Leave group. If product intent is to let leaders leave without ending or transferring the group, that requires a separate product and backend decision.
- Future direction: if native platform testing reveals that the current glass boundary does not expose enough interactive material behavior, evaluate that boundary once for all glass surfaces rather than adding a selector-specific native bridge.
