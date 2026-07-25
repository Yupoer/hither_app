# 02 — 實作被動同行者最小呈現流程

**What to build:** 依 ticket 01 的決策，在同一 navigation tree 上提供可隨時切回完整介面的被動同行者呈現，並顯示一致的全隊集合狀態與個人進度。

**Blocked by:** 01 — 決定被動同行者呈現方式

**Status:** done

- [x] 被動模式可從完整介面進入，且在重新開啟後遵守本機偏好。
- [x] 顯示目前集合點、全域停留／前往中狀態、下一點與個人粗略進度。
- [x] 「切回完整介面」在正常、載入、空資料與錯誤狀態都可用。
- [x] 外部導航與求助維持可用，但不會產生隱含同意或付款行為。
- [x] full/passive presentation contract 測試通過。

## Implementation notes

- Preference: `pref.passiveCompanionMode` in `PreferencesContext` (device-local).
- Presentation: `PassiveCompanionPanel` on MapScreen when mode is on; same `useGroupState` / journey / progress.
- Contract tests: `apps/mobile/src/__tests__/passiveCompanionPresentationContract.test.ts`
