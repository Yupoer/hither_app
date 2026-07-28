# 2026-07-28 外出實測穩定性與即時體驗 Spec

**狀態：** ready-for-agent  
**日期：** 2026-07-28  
**範圍：** 集合點、定位與個人進度、Live Activity、成員更新、被動模式、外出實測當機與效能、Apple/Google 地圖

## Problem Statement

外出實測時，App 的集合點狀態、個人定位與各顯示面沒有穩定共用同一份即時資料。藍點已由本機定位持續更新，但集合點卡片、我的進度與 Live Activity 的距離、ETA、進度仍可能等待後端回傳；抵達後也可能殘留旗幟陰影、同步黑條，或讓「先不要完成」後的主要按鈕回到錯誤的「開始」狀態。

Live Activity 同時出現完整與簡化內容，簡化內容可能顯示隊伍名稱而非集合點名稱，圖示層級也與交通方式不符。成員頁面的強制更新會顯示不必要提示，且自己的位置未必立即刷新。被動模式則使用另一組縮減快捷指令，沒有和完整模式共用自訂指令能力。

2026-07-28 09:00–13:00（Asia/Taipei；01:00–05:00 UTC）的外出使用另出現兩條高風險問題：

1. 設定內「立即更新」後離開 App，以及重新開啟後從「查看我的隊伍」進入隊伍時發生閃退。
2. 長時間使用期間裝置明顯發熱、UI 卡頓，甚至干擾同機 Podcast 音訊。

目前不能在沒有證據下把發熱歸因於 Supabase、定位、地圖渲染或診斷上傳。必須先對指定時間窗的效能/診斷事件、OTA 啟動狀態、native termination、定位工作、網路寫入與 UI frame/thermal 指標做關聯，並產出完整的後端外送動作與頻率清單。

## Solution

讓本機位置取樣成為個人即時距離、ETA 與進度的唯一前景資料源，再將同一份衍生結果供集合點卡片、我的進度與 Live Activity 使用；後端上傳只負責隊伍共享與跨裝置同步，不阻塞本機顯示。

修正集合點抵達與完成狀態的顯示契約、卡片遮罩層級、主要按鈕狀態，以及目前目標旗幟的低成本週期提示。Live Activity 保持單一活動與同一 Content State，在 iOS 系統允許的各尺寸中呈現一致語意；鎖定畫面與展開 Dynamic Island 顯示完整資訊，compact/minimal 保留系統尺寸限制下可放置的核心資訊。

先以指定實測時間窗完成 crash、thermal、CPU、memory、background callback、location cadence、network write 與 render churn 的證據報告，再修正被證實的 OTA/隊伍進入生命週期與耗能熱點。所有效能調整須保留定位、抵達、Live Activity、離線 outbox 與團隊同步語意。

Google 地圖在 SDK 能力允許時預設啟用原生大眾運輸圖層。Apple MapKit 沒有等價的整張 transit layer 開關，因此使用標準地圖、大眾運輸 POI 與 transit 路線能力，不偽造自有捷運/鐵路資料圖層。

## User Stories

1. As a member, I want a completed gathering point marker to lose its active shadow, so that it no longer looks actionable.
2. As a member, I want nothing rendered behind a gathering point card, so that pending-sync content never leaks through the card.
3. As a leader, I want deferring completion after everyone arrives to leave a visible Complete action, so that I can finish the stop later.
4. As a leader, I want a deferred completion never to restore Start for the same active stop, so that the state machine remains actionable.
5. As a member, I want my local blue-dot sample to immediately update my distance, so that the UI follows my actual movement.
6. As a member, I want the gathering point card to update distance and ETA from local samples, so that it does not wait for Supabase.
7. As a member, I want My Progress to update from the same local calculation, so that it agrees with the gathering point card.
8. As a member, I want Live Activity distance, ETA, and progress to update from the same calculation, so that the lock screen agrees with the App.
9. As a member, I want temporary GPS loss to retain the last valid value and freshness state, so that progress does not jump to nonsense.
10. As a member, I want arrival/completion to override numeric progress consistently, so that completed states do not regress after a late sample.
11. As a member, I want the full Live Activity to show gathering point name, distance, ETA, progress, and arrived-member count, so that it is useful without opening the App.
12. As a member, I want every Live Activity size to refer to the gathering point rather than the team name when a target exists.
13. As a member, I want only the current travel-mode icon in the Live Activity header, so that duplicate transport/crook icons do not compete.
14. As a member, I want the crook brand mark replaced by the active travel-mode image where requested, so that the activity communicates the current mode.
15. As a member, I want only one Live Activity per navigation session, so that push-to-start and foreground startup do not leave duplicate variants.
16. As a member, I want the current target flag to animate briefly every five seconds, so that I can distinguish it from other gathering points.
17. As a member, I want the target animation to stop when the target changes or navigation ends, so that stale markers do not keep drawing attention.
18. As a member, I want Force Refresh to update my own location immediately before requesting peer updates, so that my timestamp and marker are current.
19. As a member, I do not want a success alert after requesting peer updates, so that the refresh action stays unobtrusive.
20. As a member, I still want actionable permission, cooldown, and failure feedback, so that silent failure is not mistaken for success.
21. As a passive-mode user, I want the entry title shortened to「被動模式」and its explanation reduced to one line, so that the choice is easier to scan.
22. As a passive-mode user, I want exactly the same command catalogue as「全部快捷指令」, so that mode changes do not remove actions.
23. As a passive-mode user, I want to create and send custom commands, so that accessibility mode does not reduce capability.
24. As a user applying an OTA update, I want the App to reload once into a valid navigation/session state, so that update does not appear as a crash.
25. As a returning user, I want entering a joined team after an update to be idempotent, so that stale membership or Live Activity cleanup cannot terminate the App.
26. As an operator, I want the 2026-07-28 field session correlated across update ID, runtime version, build, device, thermal state, crash class, screen, and action, so that the cause is evidence-based.
27. As an operator, I want every passive and user-triggered backend write listed with trigger, cadence, batching, retry, and payload class, so that request storms are visible.
28. As a Podcast listener, I want navigation and background work to stay within CPU, thermal, audio, and watchdog budgets, so that Hither does not degrade other apps.
29. As a release owner, I want release-like device verification rather than source-only assertions, so that native crashes and heat regressions are caught.
30. As a Google Maps user, I want supported public-transit lines and stations emphasized by default, so that transit travel is easier to orient.
31. As an Apple Maps user, I want public-transport POIs and transit routing used by default where available, so that the experience is transit-oriented within MapKit limits.
32. As a user in a city without transit coverage, I want the base map and navigation to remain usable, so that optional transit data never blanks the map.

## Implementation Decisions

### Shared local progress

- Reuse the existing foreground location owner and geo helpers. Do not create another watcher, polling loop, progress store, or backend round trip.
- Derive distance from the latest accepted local coordinates and the active gathering point coordinates.
- Derive ETA from the same distance and selected travel mode. Keep the existing coarse model unless route-service evidence is available; do not present it as turn-by-turn ETA.
- Derive progress from initial session distance and current local distance, clamped to 0–100%. Arrival and completed states remain authoritative terminal states.
- Publish one memoized personal progress model to the gathering point card, My Progress, and Live Activity. Backend location cadence remains independent.
- Reuse the current local UI acceptance gates to avoid GPS jitter. Surface stale/unknown state instead of replacing the last valid value with zero.

### Gathering point UI and state

- A completed point must use a non-active marker style with no glow/shadow/elevation associated with the active target.
- The gathering card container must be opaque/isolated enough that no outbox or pending-sync banner can appear behind it. The pending-sync message may exist elsewhere but not in the card stack.
- After a leader chooses「先不要完成」, the point stays personally arrived and the primary action resolves to Complete. It must not transition back to Start.
- Reuse the existing gathering command/state resolver and complete-stop action; do not add a second deferred-completion state unless evidence proves the current derived state cannot represent it.

### Live Activity

- Use one ActivityKit activity per navigation session/destination. Reconcile push-to-start activities with foreground startup instead of showing two concurrent activities.
- Use gathering point title whenever a destination exists; team name is fallback-only when no destination title is available.
- Lock Screen and expanded Dynamic Island show title, distance, ETA, progress, and arrived/total members.
- iOS controls whether the Lock Screen, expanded, compact, or minimal presentation is visible. The App cannot force expanded presentation while foreground/background changes; compact and minimal layouts must therefore provide semantic parity within their fixed slots.
- Remove the duplicate transport icon before「前往集合點」. Use the active travel-mode artwork as the leading identity requested by the product, while keeping an accessible text label.
- Throttle native Live Activity updates using the existing rounded distance, ETA, and progress buckets. Database session persistence remains less frequent than local activity updates.

### Target marker animation

- Animate only the active destination marker, once per five-second cycle, with a short scale or tilt pulse.
- Use the existing animation/runtime dependency and native-driven/UI-thread animation where supported.
- Do not enable continuous marker bitmap tracking. The marker returns to a static state after each pulse and stops on target change, completion, backgrounding, or unmount.
- Respect Reduce Motion by replacing motion with a static emphasis.

### Member refresh

- Force Refresh first invokes the existing one-shot self location path and immediate upload, then asks the server to fan out refresh requests to peers.
- Remove the success alert only. Permission, cooldown, and failure messages remain.
- Update the local self marker/timestamp from the returned sample without waiting for the subsequent group refresh.

### Passive mode and commands

- Change the entry title to「被動模式」and use one concise explanatory line.
- Reuse the same command catalogue, role gating, send action, and custom-command sheet as「全部快捷指令」.
- Do not keep a separate leader/member three-command list inside passive mode.
- Preserve the existing explicit-tap rule: passive mode never implies consent, payment, voting, or safety confirmation.

### Crash and performance investigation

- The evidence window is 2026-07-28 09:00–13:00 Asia/Taipei, equivalent to 01:00–05:00 UTC.
- Correlate performance events, diagnostic events, MetricKit/native termination, OTA update ID/runtime/build, last screen, active UI action, navigation session, background operation timelines, thermal state, CPU, memory, frame stalls, location mode, and network counts.
- Treat `reloadAsync` as an intentional process reload unless the following launch records a native termination or unhandled error. Prevent duplicate manual/automatic apply work with a single-flight update lifecycle.
- Audit the post-update team-entry path for stale navigation params, membership hydration, Live Activity cleanup, native map mount, and duplicated async callbacks. Make entry idempotent.
- Produce an exhaustive outbound-write inventory before changing cadence. Each row must name the user/system trigger, foreground/background state, current minimum/heartbeat cadence, batch size, retry/backoff, destination table/function, and whether it wakes GPS/radio.
- Current verified hot-path anchors include foreground outbox coalescing, a 15-second heartbeat evaluator, motion-dependent location heartbeats, 30-second minimum Live Activity session persistence, diagnostic batches at 100 records or 15 minutes, and 1.5-second error flush debounce. These are starting evidence, not the complete inventory.
- If network/upload work is not the dominant cause, inspect map marker bitmap tracking, Reanimated work, MapScreen render frequency, route recomputation, Live Activity native updates, performance sampling, background callbacks, and simultaneous location owners.
- Fix only measured hot paths. Preserve safety, privacy, offline outbox, arrival, and Live Activity behavior.

### Transit-oriented maps

- Google Maps: enable the SDK's native transit layer by default where the installed native SDK exposes it; retain the normal base map and degrade gracefully where transit data is unavailable.
- Apple MapKit: keep the standard map, include/emphasize public-transport POIs, and use transit transport type for directions. MapKit does not expose a Google-equivalent transit network layer toggle, so do not promise colored transit lines through configuration alone.
- Do not add a third-party transit dataset, custom rail overlay, or new map SDK for this task.
- Verify native dependency support before exposing a setting. If the React Native wrapper does not expose the Google transit property, add the smallest native prop bridge rather than replacing the map component.

## Testing Decisions

- Prefer the highest existing seams: gathering command/state resolver, personal progress derivation, location policy gates, Live Activity Content State, shared command catalogue, OTA update utility, and map provider props.
- Test external behavior, not hook internals or exact component markup.
- Extend existing gathering command and local-first contracts for the defer-to-complete transition, completed marker styling, and absence of a card-stack sync banner.
- Add one table-driven personal-progress test covering movement toward/away from target, jitter gating, stale sample, arrival, completion, travel-mode ETA, and clamping.
- Verify the same personal progress model feeds card, My Progress, and Live Activity without a backend response.
- Extend Live Activity contracts for single activity reconciliation, gathering-title precedence, complete expanded content, compact fallback, icon rules, and persistence throttling.
- Extend location refresh tests to prove self refresh occurs before peer fan-out, success alert is absent, and failure/cooldown feedback remains.
- Extend passive presentation tests to prove command parity and custom-command access without implicit actions.
- Add OTA/team-entry lifecycle tests for single-flight reload, update-state hydration, repeated taps, and idempotent group entry.
- Add target-marker animation tests for active target only, five-second cadence, cleanup, Reduce Motion, and disabled continuous bitmap tracking.
- Add provider/native contract tests for Google transit enablement and Apple public-transport POI/transit route behavior.
- Run focused Jest suites and TypeScript checks for every ticket.
- Before closure, run release-like iOS and Android device sessions with Podcast/audio playback, foreground/background transitions, high-accuracy on/off, map open, Live Activity active, and Force Refresh. Compare CPU, thermal, memory, frame stalls, audio interruption, radio/network counts, and watchdog events against the recorded baseline.

## Out of Scope

- Guaranteeing that iOS always shows an expanded Dynamic Island or Lock Screen layout; the system chooses presentation size.
- Pixel-identical Live Activity layouts across system-controlled size classes.
- A custom public-transit network dataset or a replacement for Apple/Google map data.
- Turn-by-turn route-quality ETA generated solely from straight-line distance.
- Removing location sharing, offline outbox, arrival detection, safety feedback, or privacy controls to gain performance.
- Blanket reduction of all backend sync frequencies without the outbound-write inventory and measured evidence.
- Adding a new analytics SDK, state-management framework, map SDK, or command subsystem.
- Redesigning unrelated settings, team management, or itinerary flows.

## Further Notes

- The reported「兩種 Live Activity」is not proven to be caused by foreground/background state. The current code also has push-to-start and locally started activity paths; duplicate/reconciliation behavior must be checked first.
- Source contracts already state that the gathering card should not show the pending-sync message and that defer should leave Complete available. Device reproduction is required to locate the divergence between those contracts and runtime composition/state.
- Apple documents transit as a directions transport type and exposes public transport as a POI category, but its standard configuration has no dedicated transit-network layer switch: [MKDirectionsTransportType](https://developer.apple.com/documentation/mapkit/mkdirectionstransporttype), [publicTransport POI](https://developer.apple.com/documentation/mapkit/mkpointofinterestcategory/publictransport), [MKStandardMapConfiguration](https://developer.apple.com/documentation/mapkit/mkstandardmapconfiguration).
- Google Maps SDK for iOS supports `transitEnabled`; Android SDK 20.0.0 added `setTransitEnabled()`. Transit data remains coverage-dependent: [Google Maps iOS transit layer](https://developers.google.com/maps/documentation/ios-sdk/configure-map), [Google Maps Android release notes](https://developers.google.com/maps/documentation/android-sdk/release-notes).
- Future direction: after this task, maintain per-build field-session dashboards for crash-free navigation, thermal state, background callback duration, render stalls, location uploads, and Live Activity updates.
- Future risk: adding a target animation and more frequent local UI updates can recreate heat/jank if marker bitmap tracking or whole-screen renders are re-enabled; device performance gates are mandatory.
