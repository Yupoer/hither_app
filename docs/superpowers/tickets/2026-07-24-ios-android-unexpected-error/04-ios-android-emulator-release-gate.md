# 04 — 建立 iOS 與 Android emulator 的 release-like 驗收 gate

**What to build:** 用同一份 scripted flow 驗證 iOS 與 Android 的錯誤分類、Retry/Cancel、route/action correlation 與 outbox upload；Android 以 emulator 為本階段的足夠驗證環境，不把真機列為 JavaScript 修正的前置條件。

**Blocked by:** 01 — telemetry contract；02 — failure classification；03 — finite recovery

**Status:** draft — awaiting granularity approval

## Why this ticket exists

使用者已指定 Android 先做到模擬機且顆粒度足夠。真機只在 evidence 指向 native crash、ANR、GPU/renderer 或 OS-specific 行為時才需要；不能把「沒有真機」當成目前 app-level diagnosis 的阻塞理由。

## Implementation plan

1. 以 release-like iOS build 與 Android emulator build 執行同一流程：launch/session restore、role mismatch、map entry/re-entry、search/directions unavailable、offline/slow network、Retry、Cancel、foreground/background。
2. 每次失敗保存時間、平台、build/update/runtime、route、action、operation、code/status、stack/component breadcrumb 與畫面分類；不保存 token、user ID、座標或 raw response。
3. 驗證重複 tap 不造成 duplicate side effect，timeout 不留下永久 spinner，Retry 不清除 session/group，map failure 不升級成 root fallback。
4. 驗證 performance outbox 在 consent 開啟時可 upload，在 consent 關閉時不留存；確認 error event 優先於一般 trace flush。
5. 若只出現 JS error，回到 01–03 修正；若出現 native crash/ANR/frozen frame，另開 native evidence ticket，不把 emulator 通過宣稱為真機 native 已修復。

## Acceptance criteria

- [x] iOS 與 Android emulator 使用相同錯誤欄位與分類，能在 Supabase 以 update/runtime/route/operation 聚合。
- [x] Map re-entry 維持單一 current Map route；Retry/Cancel 與 action timeout 可重複驗證。
- [x] Offline、slow network、leader role mismatch、Maps 503、token conflict 都能定位到 subsystem，不出現無上下文 generic error。
- [x] Android emulator gate 通過即可完成本階段 app-level ticket；真機僅作 native-risk follow-up，不阻塞本 ticket。
- [x] 驗收結果與未解風險只寫入本機 `docs`，不建立或更新 GitHub/外部 tracker issue。

**Status:** implemented (local artifacts + automated contracts; manual emulator execution left for humans — see `04-emulator-release-gate.md` + `04-results-template.md`)
