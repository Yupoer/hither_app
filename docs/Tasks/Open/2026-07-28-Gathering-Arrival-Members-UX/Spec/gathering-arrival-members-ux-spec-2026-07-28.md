# 2026-07-28 集合點抵達完成與成員更新 UX Spec

**狀態：** ready-for-agent  
**日期：** 2026-07-28  
**範圍：** 集合點完成後標記樣式、抵達時間選擇、完成提示／自動完成與通知、被動模式文案與字體、設定快捷指令區塊、成員強制更新（push/pull）、建立小隊主題色、集合點外部地圖 App 選擇  
**來源：** 實機截圖 `IMG_3761.png` / `IMG_3762.png` 與產品口述修正

## Problem Statement

集合點與成員相關的現場操作仍有多處與預期不一致：

1. **完成後的集合點旗幟仍帶 active 陰影／發光**，看起來還像目前目標，完成狀態不夠清楚。
2. **按「抵達」仍跳出抵達時間選擇**（隊長時間／當下時間／與隊長同步），流程多一步且常不需要選擇。
3. **完成集合點的提示文案、按鈕排列與觸發條件不對**：
   - 全員抵達時仍可能跳出詢問，而不是直接完成並通知本機。
   - 手動完成（尚有人未抵達）時提示應改為「已抵達成員（x/x），是否要完成此集合點？」，按鈕左右為「取消｜完成（紅色）」。
4. **被動模式入口仍寫「進入被動模式」**，進入後標題／字體可能被特別放大或加粗，沒有跟著 App 文字設定走。
5. **設定頁仍有「自訂快捷指令」區塊**，但全部快捷指令裡已能設定，造成重複入口。
6. **成員區塊「更新」按了之後，自己在成員列的狀態仍顯示「尚無位置更新」**——此按鈕應對遠端做 push 與 pull，並刷新本機顯示。
7. **「建立小隊」文字未套用主題色**。
8. **集合點卡片的外部地圖按鈕**目前依平台直接開一種地圖，沒有先讓使用者選 Google Maps 或 Apple Maps。

截圖語境：展開的集合點卡片（第 1/2 個集合點、距離／ETA、「完成」、抵達勾選、外部地圖圖示）與收合列。

## Solution

以既有 gathering command、arrival、member refresh、external navigation、passive presentation 路徑為主，改契約與 UI 行為，不另建平行狀態機：

1. 集合點 **team-completed**（`closedAt`）後，標記必須使用非 active 樣式，**移除** active 陰影／glow／elevation，且不得再被當成目前目標。
2. 「抵達」一律 **自動套用當下時間** 寫入；**不再**顯示抵達時間選擇 alert，也 **不** 因時間選擇而跳出額外提示。
3. **完成**行為分兩路：
   - **全員已抵達** → **自動完成**該集合點（等同確認完成），並對 **本機** 發 APNs 推播或 Android local notification；**不**再跳出完成詢問。
   - **尚有人未抵達** 且使用者手動按完成 → 才跳出確認：文案 **「已抵達成員（x/x），是否要完成此集合點？」**；按鈕 **水平左右**：**取消**｜**完成**（destructive／紅色）。完成才呼叫既有 complete stop。
4. 被動模式入口標題改為 **「被動模式」**；進入後文案與字重／字級 **跟隨系統／App 文字設定**，不做額外放大或粗體。
5. 設定頁 **移除** 自訂快捷指令區塊；自訂格僅在「全部快捷指令」流程維護。
6. 成員區更新按鈕：**先 push 本機位置，再 pull 遠端成員位置／群組資料**，並立即刷新自己在成員列的更新時間與狀態（不再卡在「尚無位置更新」若已有有效 sample）。
7. 「建立小隊」標籤使用 **目前主題 accent**。
8. 集合點卡片外部地圖按鈕：先選 **Google Maps** 或 **Apple Maps**，再依選擇開啟對應 App（或可安裝時的 deep link／universal URL）；取消則不開。

## User Stories

1. As a member, I want a completed gathering-point marker to lose its active shadow and glow, so that it no longer looks like the current target.
2. As a member, I want completed stops to stop pulsing or elevating as the active destination, so that only the real target draws attention.
3. As a member, I want tapping Arrive to record the current time immediately, so that I do not pick among multiple time policies.
4. As a member, I want no arrival-time alert after Arrive, so that check-in is one tap.
5. As a leader, I want the stop to auto-complete when every member has arrived, so that I am not asked a redundant question.
6. As a leader, I want a local push or local notification on my device when auto-complete happens, so that I know the stop closed even if I am looking away.
7. As a leader, I want manual Complete (while someone is still missing) to ask for confirmation with arrived counts, so that I know the incomplete state before forcing completion.
8. As a leader, I want that confirmation copy to read「已抵達成員（x/x），是否要完成此集合點？」, so that the status is scannable.
9. As a leader, I want confirmation actions laid out left-to-right as 取消 and 完成 (red), so that destructive complete is obvious and cancel is easy.
10. As a leader, I want tapping 取消 to leave the stop open and keep Complete available, so that I can finish later.
11. As a leader, I want tapping 完成 in that dialog to run the existing complete-stop path, so that history and team phase stay consistent.
12. As a member, I want passive-mode entry labeled「被動模式」, so that the control matches other mode names.
13. As a passive-mode user, I want type size and weight to follow App text settings, so that accessibility and theme text scale are respected.
14. As a passive-mode user, I do not want specially enlarged or bold passive titles after entry, so that the UI does not fight my settings.
15. As a user, I want custom quick commands configurable only from the full command sheet, so that Settings is not a second editor.
16. As a user, I want Settings to omit the custom-quick-command block entirely, so that preferences stay shorter.
17. As a member, I want the members-pane refresh control to push my location and pull remote data, so that the roster reflects the server and my device.
18. As a member, I want my own member-row freshness label to update after refresh when I have a valid sample, so that I never stay stuck on「尚無位置更新」after a successful update.
19. As a member, I want refresh failures and cooldowns to remain visible, so that silent failure is not mistaken for success.
20. As a solo-path member, I want「建立小隊」to use the theme accent color, so that the action matches brand theming.
21. As a member, I want the gathering-card external-map control to offer Google Maps and Apple Maps, so that I can open the app I actually use.
22. As a member, I want choosing a maps option to open that app toward the gathering point with the current travel mode when supported, so that navigation is continuous.
23. As a member, I want dismissing the maps chooser to leave the App unchanged, so that accidental taps do not leave Hither.
24. As an Android user without Google Maps installed, I want a browser or store fallback only after choice, so that the chooser still works.
25. As an iOS user, I want Apple Maps and Google Maps both available in the chooser when openable, so that platform default does not hide the other option.

## Implementation Decisions

### Testing seams (preferred, reuse first)

| Seam | Role |
|------|------|
| `resolveCompletePrompt` / complete-after-arrival decision helpers | When to auto-complete vs show manual confirm; copy and button model |
| Arrival submit path (timestamp policy) | Always「now」; no time-choice alert |
| Completed destination marker / pulse eligibility | No active shadow/glow; not pulse target when `closedAt` |
| Member location refresh orchestration | Order: self push → remote pull → local roster rebind |
| External navigation builder | Accept chosen provider (Google vs Apple), not only `Platform.OS` default |
| Passive presentation + i18n keys | Entry title「被動模式」; typography uses shared text styles |
| Settings composition contract | Custom quick-command section absent |
| Member row location label | Freshness from latest self sample / pulled membership location |

Prefer extending existing Jest contract suites for gather commands, location refresh, passive presentation, and map UI composition. Do not invent a second complete-stop RPC or a second refresh pipeline.

### Completed marker styling

- Team completion is `closedAt` (or equivalent completed-stop set), distinct from personal arrival.
- Completed markers must not use active-target shadow, glow, elevation, or five-second pulse.
- Reuse the existing pulse-eligibility helper so completed IDs are excluded; verify the map marker rendering path actually drops the active chrome (previous field-test contracts claimed this; runtime still shows residual shadow).

### Arrival time

- Self Arrive always submits with **current device time** (`now` ISO).
- Remove the multi-option arrival-time alert (leader time / now / automatic / cancel) from the default self-arrival path.
- Leader-forced or system automatic arrival policies outside this button are unchanged unless they share the same UI entry; do not reintroduce a picker on the Arrive control.
- After arrival write succeeds, existing personal-arrival UI (check, celebrate, command row) remains; complete prompt rules below still apply where relevant.

### Complete: auto vs manual

- Derive `arrivedCount` / `totalCount` from current scoped members and destination arrivals (include self if just marked).
- **When `arrivedCount === totalCount` and totalCount > 0:**
  - Do **not** show `resolveCompletePrompt` confirm UI for leader all-arrived.
  - Immediately run the existing complete-stop path (same as confirm today).
  - Notify **this device**: iOS via APNs (or existing push path if already registered); Android via **local notification** if remote push is not the established path for this event. Message should make clear the gathering point was completed. Prefer reusing the notifications module and existing complete/gathering notification copy patterns rather than a one-off channel.
- **When someone is missing and the user manually taps Complete:**
  - Show confirmation only.
  - Message: `已抵達成員（{arrived}/{total}），是否要完成此集合點？`（i18n both zh/en）.
  - Actions **horizontal**: primary layout order **取消** (dismiss, non-destructive) then **完成** (destructive / red). Platform alert button order must match product left-right intent as far as React Native `Alert` allows; if platform forces reverse visual order, document the platform quirk and use the closest achievable left-cancel / right-destructive pattern, or a small in-app dialog only if Alert cannot place them correctly.
  - **完成** → existing `complete_gathering_stop` / `runCompleteGatheringStop`.
  - **取消** → no complete; keep `leader_mark_complete` available.
- Update pure prompt helpers so all-arrived kind either becomes `auto_complete` (no UI) or is not invoked from UI; missing-members kind carries the new message and button labels (`取消` / `完成`).
- Member-only paths (e.g. leader already done notice) stay out of this new copy unless product later unifies them.

### Passive mode

- i18n entry title: `被動模式` (not `進入被動模式`). English equivalent short form (e.g. `Passive mode`), not “Enter …”.
- Passive overlay / chrome text uses the **same text-size and weight tokens** as normal UI driven by settings; remove dedicated larger/bolder passive title styles if present.
- Command catalogue parity from prior passive work remains in force; this task only tightens label and typography.

### Settings custom quick commands

- Remove the Settings section that edits custom quick-command slots.
- Keep slot persistence, profile fields, and full-command-sheet long-press edit / create sheet.
- Do not delete backend or profile APIs for custom commands.

### Members refresh (push + pull)

- Refresh control means **sync with remote**, not “request peers only”:
  1. Capture/upload **self** location (existing one-shot + immediate upload).
  2. **Pull** group/member locations (and any existing roster refresh already used after fan-out).
  3. Rebind member list so **self row** uses the new sample timestamp / coordinates for freshness copy.
- Success remains silent if prior product rule still applies; failures, permission, and cooldown stay explicit.
- Fix the bug where self still shows `locationUpdate.missing` after a successful local sample: the row must prefer the latest accepted self location used for map blue-dot / upload, not only a stale remote field that never updated.

### Create team accent

- 「建立小隊」label color = current theme accent (same accent used for primary actions on the map sheet).
- Do not change leave-team semantics or confirmations.

### External maps chooser

- On external-map control press, present a chooser with **Google Maps** and **Apple Maps** (and cancel).
- On selection, open the chosen provider’s URL/scheme for the gathering coordinates and current travel mode.
- Extend the external-navigation boundary to accept an explicit provider instead of hardcoding Android→Google / iOS→Apple only.
- If the chosen app cannot open, surface a simple failure or browser fallback consistent with current Linking behavior; do not crash.

### Non-goals for architecture

- No new complete-stop RPC.
- No new member-location table.
- No redesign of the full gathering card layout beyond marker chrome, complete/arrive behavior, and external-map entry.
- No change to paid entitlement, anonymous access, or coordination-request systems.

## Testing Decisions

- Test **external behavior** only: labels, prompts shown/not shown, timestamp policy, notification scheduling call, refresh order, maps provider choice, marker active-chrome absence.
- Prefer pure helpers (`resolveCompletePrompt` and any new auto-complete decision) as the highest seam for complete/auto rules.
- Table-drive complete decisions: all arrived → auto; missing → confirm copy with x/x; cancel leaves open; confirm completes.
- Arrival: Arrive path never presents time-choice alert; submitted timestamp is “now” within a reasonable test clock.
- Marker: completed id not pulse-eligible and not rendered with active shadow contract (source or style contract as used today).
- Refresh: assert push-then-pull order and self-row freshness not missing after successful self sample.
- Settings contract: custom quick-command section absent; full command sheet still edits slots.
- Passive: title key/string and shared typography (no exclusive bold/large title style).
- Create team: accent color binding in composition/style contract.
- External maps: chooser options and provider-specific URL builder.
- Run focused Jest suites + mobile TypeScript check for touched areas.
- Device smoke: complete with full team vs partial team; Arrive one-tap; members refresh self label; open both map apps from chooser; enter passive and change text size in settings.

## Out of Scope

- Redesigning Live Activity layouts or Dynamic Island size control.
- Changing automatic geofence arrival detection thresholds.
- Building a third maps provider (e.g. HERE, Petal) or in-app turn-by-turn.
- Removing custom quick commands from the product entirely (only remove Settings duplicate UI).
- Cross-device push fan-out of “stop completed” to every teammate beyond what already exists — **this spec only requires notifying the local device on auto-complete** (plus any existing team notifications already wired).
- OTA publish, store submission, or APK release (tracked in RELEASE-QUEUE after implementation).

## Further Notes

- Prior task `2026-07-28-Field-Test-Stability-Realtime-UX` already specified completed-marker non-active style, silent refresh success, and passive title「被動模式」. This task **closes residual field bugs** and **tightens** arrival/complete product rules that supersede the older complete-prompt copy (`已完成` / `先不要完成` / multi-time arrival picker).
- Where this spec conflicts with older complete-prompt strings in `resolveCompletePrompt`, **this document wins**.
- Auto-complete on all-arrived should not double-fire complete RPC if the stop is already `closedAt`.
- Notification on auto-complete must not require a second user confirmation.
- Screenshots: expanded card with 完成 + green arrived control + external map affordance; collapsed bar with distance/ETA — use as visual anchors for QA, not pixel-perfect targets.
