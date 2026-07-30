# 08 — 建立原地發熱的可比較效能基線

**What to build:** 使用固定裝置、release-like build 與固定操作腳本，分辨手機原地發熱主要來自定位、網路／Realtime、Live Activity、地圖／路線、React render 或其他原生工作，並留下可供後續修正比較的證據。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 固定裝置、build SHA、電量區間、亮度、網路、前景時間、High Accuracy 設定與測試起始溫度。
- [ ] 至少量測靜置地圖、原地連續點擊、行程中靜止，以及 High Accuracy 開／關四種情境。
- [ ] 每個情境記錄 CPU、thermal state、frame stall、記憶體、定位 callback／owner、路線重算、Realtime callback、render count、outbox enqueue／flush、網路請求與 Live Activity token 註冊次數。
- [ ] 匯入本次 diagnostic bundle 作為初始證據，保留 outbox p50／p95／max、超過 1 秒次數、位置上傳重試與 token conflict 次數。
- [ ] 明確區分相關性與根因；`previous_launch_incomplete`、unknown native metric 與體感發熱不得直接標記成 crash 或單一 root cause。
- [ ] 每個高耗用事件可關聯到 session、navigation session、App state 與執行階段，且不記錄敏感位置內容。
- [ ] 產出 before baseline、原始 trace 位置、重現步驟、主要熱點排名及 Ticket 09–11 的具體進入條件。
- [ ] 無法取得實機、symbolicated 或 thermal evidence 時，記錄為驗證限制，不宣稱發熱已定位或已改善。
