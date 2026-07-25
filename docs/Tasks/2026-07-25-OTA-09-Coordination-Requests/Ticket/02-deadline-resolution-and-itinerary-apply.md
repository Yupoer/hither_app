# 02 — 期限結案與行程結果套用

**What to build:** 讓 server 依 policy 在期限到達時原子決定結果，並以版本化操作套用被接受的集合點、時間、路線或行程變更。

**Blocked by:** 01 — 建立協調請求生命週期

**Status:** done

- [x] 支援 organizer override、unanimity、majority、timeout default 的結案語意，或明確標示尚未開放的 policy。
- [x] deadline resolution 在重複觸發時只產生一個結果。
- [x] 已接受的結果建立可追蹤的 itinerary version／operation。
- [x] 多裝置在 realtime 更新後顯示相同的 resolved outcome。
- [x] 請求結案不會改寫既有歷史紀錄。
