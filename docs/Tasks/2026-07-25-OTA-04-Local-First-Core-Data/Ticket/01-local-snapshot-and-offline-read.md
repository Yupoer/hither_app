# 01 — 核心旅程快照與離線讀取

**What to build:** 讓旅團成員在沒有網路時仍可冷啟動並讀取最近一次同步的 group snapshot、itinerary、目前集合點狀態與個人回應。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 第一批核心資料可保存於 SQLite 並帶有 freshness metadata。
- [x] 冷啟動離線時 UI 可從 SQLite 還原旅團與 itinerary。
- [x] active gathering state 遵守 OTA-01 的全域與單點狀態語意。
- [x] 個人 navigation response 不會污染全隊狀態。
- [x] 離線讀取、空快照與過期快照都有可理解的 UI 結果。
