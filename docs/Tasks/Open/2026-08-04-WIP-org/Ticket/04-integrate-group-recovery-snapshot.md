# 04 — 整合單一群組 Recovery Snapshot

**What to build:** 讓 60 秒保底恢復以一個具版本的 server snapshot 取得完整群組狀態，並保證舊 response 不覆蓋較新的 Realtime、group generation 或 optimistic mutation。

**Blocked by:** 02 — 將已提交 Premium／Map 修正重播到最新 master。

**Status:** ready-for-agent

- [ ] 單一 RPC 回傳恢復所需群組資料與明確 revision／freshness marker，取代同輪多 endpoint 完整重抓。
- [ ] Realtime 仍是正常即時來源，60 秒 snapshot 只作 missed-event recovery，不改變既有產品 cadence。
- [ ] group switch、sign-out、unmount 與 overlapping requests 均由 group identity／generation fence 隔離。
- [ ] 較新 Realtime revision 或 pending optimistic mutation 不被舊 snapshot response 覆蓋；in-flight 期間有新事件時安排必要 follow-up。
- [ ] SQL runtime 測試驗證 snapshot consistency 與 authorization，Client state harness 驗證 out-of-order race。
- [ ] 只通過 Jest 時標成 Client Passed／server runtime Unverified，不宣稱 migration 已部署。
- [ ] Snapshot 相關 migration、tests、Client contract 與文件在清冊中全部有落點。
