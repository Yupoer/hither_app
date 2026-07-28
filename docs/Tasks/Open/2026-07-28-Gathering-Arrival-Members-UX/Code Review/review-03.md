# Code Review Re-review — Codex review-02 fixes (2026-07-28)

**Reviewer:** Codex  
**Review type:** Working-tree fix re-review  
**Base:** `HEAD` (`b50d6791d878f85a791ce23d71c69e55640bb6bb`)  
**Diff:** `git diff HEAD -- apps/mobile`  
**Fix report:** `Report/codex-review-02-fixes.md`  
**Original spec:** `Spec/gathering-arrival-members-ux-spec-2026-07-28.md`

## Verdict

**Request changes.**

遠端最後抵達的 effect、scoped decision helper、抵達成功後才排程完成，以及外部地圖失敗提示均已加入；但仍有 **1 個 P1、3 個 P2 Spec 問題**，並新增 **1 個 documented-standard hard violation**。

## Standards

### Hard violation

- **[P2] UI screen 直接判斷 `Platform.OS`**

  `apps/mobile/src/screens/MapScreen.tsx:2366-2369` 在 UI screen 內分支平台。

  `CLAUDE.md`「現況／原生層」明定：UI 元件禁止直接判斷 `Platform.OS`；原生能力與平台差異應位於 `src/native/`，並提供 fallback。

### Judgement-call smells

- **[P2] Duplicated Code** — `MapScreen.tsx:2366-2369` 的 Android 與 else body 完全相同，平台分支沒有產生任何行為差異。
- **[P2] Duplicated Code** — guarded auto-complete 流程重複於 `MapScreen.tsx:2404-2412` 與 `:2543-2551`：記錄 destination、執行 complete、失敗清除、成功通知。
- **[P2] Duplicated Code / Divergent representation** — `utils/gatherCommand.ts:254-280,355-377` 保存中文提示文案，`MapScreen.tsx:2420-2440` 又以 i18n 重建同一份 presentation；runtime UI 不使用 helper 中的大部分字串。
- **[P3] Speculative Generality** — `utils/gatherCommand.ts:265-270,362-364` 新增 `cancelLabel`，但仍保留沒有外部 caller 需要的 deprecated `deferLabel`。
- **[P3] Duplicated Code** — `__tests__/targetMarkerPulse.test.ts:62-70,80-88` 重複載入相同的 `fs`、`path` 與 `GroupMap.tsx`。

## Spec

- **[P1] 抵達寫入失敗後，手動 Complete 仍可能 auto-complete**

  `MapScreen.tsx:1271-1293` 在自動抵達寫入失敗時只清除 `autoArrivalMarkedRef`，沒有清除 `autoArrivedDestId`。因此 `:4411-4416` 仍把隊長視為 `personallyArrived`，顯示 Complete。

  使用者按下 Complete 後，`:4735-4737` 呼叫 `promptCompleteAfterArrival(dest)`；`:2382-2388` 預設強制把自己加入 arrival counts。若其他 scoped members 都已抵達，程式會進入 `auto_complete`，即使隊長的 arrival row 從未成功寫入。

  違反規格：「從 current scoped members 與 destination arrivals 計算；只有 self just marked 時才 include self」，也違反修正報告宣稱的「Failed write never schedules complete」。

- **[P2] iOS notification path 仍未實作**

  `MapScreen.tsx:2362-2370` 的 Android／iOS 分支都呼叫 `scheduleLocalNotification`。新增註解與分支沒有讓 iOS 走 APNs 或既有 push path。

  規格要求：「iOS via APNs (or existing push path if already registered); Android via local notification」。

- **[P2] Member pull 失敗仍可能靜默**

  `MapScreen.tsx:1971-1975` 只用 `try/catch` 包住 `await refresh()`；但 `state/useGroupState.ts:185-238` 會在 `getGroupState` 失敗時 catch 並回傳 boolean，而不是拋出錯誤。若有 local cache，失敗甚至可能回傳 `true`。

  因此外層 catch 通常不會顯示失敗 Alert，修正報告的「pull failure shows set-failed Alert」不成立。

- **[P2] 卡片上的 arrival x/x 仍未 scoped**

  `MapScreen.tsx:4354-4359` 只按 destination 過濾 arrival rows，但 total 仍使用全隊 `members.length`；`:4555-4559` 直接顯示這組數字。子隊集合點仍會顯示錯誤總數，雖然 complete decision 已改用 scoped helper。

  規格要求 `arrivedCount`／`totalCount` 由 current scoped members 與 destination arrivals 推導。

### Verified closed

- Remote final arrival effect exists and uses committed scoped arrivals.
- Local arrival completion is scheduled only after the arrival write succeeds.
- External-map open rejection now displays an i18n failure alert.
- Unused `defaultMapsProviderForPlatform` was removed.

未發現新的 scope creep。

## Verification

- Focused Jest: **8 suites, 105 tests passed**.
- TypeScript: `npm.cmd run typecheck` passed.
- Device smoke testing was not performed.

## Summary

Standards：1 個 hard violation、5 個 judgement-call smells；最嚴重為 UI 直接判斷 `Platform.OS`。  
Spec：4 個 findings；最嚴重為 arrival write 失敗後仍可透過手動 Complete 觸發 auto-complete。
