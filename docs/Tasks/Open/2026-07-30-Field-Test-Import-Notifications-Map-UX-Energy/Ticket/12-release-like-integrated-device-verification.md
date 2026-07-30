# 12 — Release-like 實機整合驗證

**What to build:** 在 release-like iOS／Android 環境，依同一份驗證矩陣確認匯入、通知、動畫、地圖相機、Emoji 同步與耗電修正能一起運作，並將無法驗證的原生／外部條件清楚留在報告中。

**Blocked by:** 01 — 修復跨文件來源的 KML／KMZ 匯入; 02 — 統一本機、Realtime 與遠端通知政策; 03 — 完成距離驅動的抵達通知; 04 — 將調整集合點順序改為獨立操作框; 05 — 修正分享與搜尋動畫生命週期; 06 — 修正長按新增集合點的相機流程; 07 — 加入集合點專屬 Emoji 與顏色; 08 — 建立原地發熱的可比較效能基線; 09 — 消除重複 Live Activity token 衝突; 10 — 降低位置 outbox flush 延遲與失敗重試; 11 — 修正實證確認的前景耗能主因.

**Status:** ready-for-agent

- [ ] iOS 與 Android 各驗證至少一個本機／雲端文件 provider 的 KML 與 KMZ 選擇、預覽與匯入。
- [ ] 使用兩個真實帳號／裝置驗證開始行程操作者回饋、快捷指令、例外與協調、路線要求、脫隊及抵達通知。
- [ ] 通知矩陣涵蓋 sender、隊長／成員、主隊／小隊、solo、foreground／background／killed app 與重複事件去重。
- [ ] 系統分享視窗關閉、搜尋頁顯示、獨立順序操作框與 reduced-motion 動畫狀態符合 Spec。
- [ ] iOS MapKit 與 Android Google Maps 的長按 zoom、加入後 self + destination fit、失敗保持狀態符合 Spec。
- [ ] 兩台不同 OS／版本裝置能同步集合點 Emoji 與顏色；合法自訂 Emoji、舊 OS fallback 與非法輸入均符合資料契約。
- [ ] 以 Ticket 08 相同條件執行 before／after thermal scenario，附上 CPU、thermal、frame、定位、網路、outbox 與 token 註冊結果。
- [ ] focused tests、TypeScript typecheck、相關 SQL／Edge Function tests 與 diff check 通過；既有 baseline failure 需與本次 regression 分開記錄。
- [ ] 驗證報告不把 simulator、單元測試或 development build 結果宣稱為真實 APNs／FCM、原生相機或 thermal 成功。
- [ ] 本票不執行 OTA、build 發布、production migration 或商店提交；這些仍依 release queue 分開控制。
