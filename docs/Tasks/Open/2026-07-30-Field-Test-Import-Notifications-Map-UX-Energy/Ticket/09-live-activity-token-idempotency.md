# 09 — 消除重複 Live Activity token 衝突

**What to build:** 同一使用者、裝置、push-to-start token 與 enabled 狀態只需註冊一次；token rotation 可安全更新，已知衝突不會因 mount、listener callback 或狀態重播持續重送相同失敗。

**Blocked by:** 08 — 建立原地發熱的可比較效能基線.

**Status:** ready-for-agent

- [ ] 以 Ticket 08 證據確認 token 註冊觸發來源、次數、帳號／裝置 ownership 與目前 unique conflict 路徑。
- [ ] 相同 `(user, device, token, enabled)` 重複輸入為冪等，不產生額外資料庫寫入或重複 diagnostic failure。
- [ ] token rotation、App 重裝、多裝置與同一裝置切換帳號具有明確 ownership 規則，不偷取其他帳號 token。
- [ ] RLS 隱藏 owner 的 unique conflict 由 server-authoritative 操作安全判定，不以 client 無法 select row 為由無界重試。
- [ ] 暫時性錯誤使用有界 backoff；永久 ownership conflict 停止自動重試，直到 token、user 或 device 狀態改變。
- [ ] Live Activities 關閉時能保存停用狀態；重新開啟或 token 更新後仍可恢復正常註冊。
- [ ] focused 測試涵蓋冷啟動、重複 mount、listener 重播、token rotation、多裝置、切換帳號、RLS-hidden conflict 與暫時性錯誤。
- [ ] 使用 Ticket 08 相同情境重測，確認 `token_unique_unresolved` 與相應網路工作不再持續出現，且 Live Activity 功能沒有退化。
