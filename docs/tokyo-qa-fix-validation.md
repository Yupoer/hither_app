# Tokyo 三模擬器 QA 修復紀錄（#287）

來源：`/Users/dillion/Desktop/Hither/qa-runs/2026-10-03-tokyo-blocker002-fix-validation`，全部 80 份 Markdown 已稽核；檔名及 SHA256 見 `tokyo-qa-report-inventory.json`。原始 FAIL、影片與資源紀錄保持原樣。本文件的程式／測試結果不覆寫原模擬器驗收結果。

| 問題與 44 項編號 | 修復 | 回歸證據 |
| --- | --- | --- |
| 02/09/23/39–41 成員停留後跳點、倒退 | React coordinate 只初始化；後續位置由單一 native command 插值，舊 timestamp 不反向覆蓋 | memberMarkerMotion、memberMotion、GroupMap contracts |
| 06/08/21 目的地切換後舊路線回來 | 目標 identity＋request generation；同 key in-flight 不因 render 取消合法結果 | mapKitRoutes 的亂序及同 key fixtures |
| 25/40 背景全天停更、370 秒舊位置 | 全天 presence 不依賴導航；移除原生時間門檻之外的額外距離門檻；禁止 OS 自動 pause；stationary 亦遵守時間門檻 | Swift delivery policy、backgroundJourney/controller fixtures |
| 08/25/42 鎖屏舊 context、精準偏好失配 | 使用既有定位回呼每 15 秒檢查控制狀態；啟動 key 包括座標／模式／權限／成員；presence 保存 precision intent 但維持低頻 | backgroundJourneyCoverage |
| review/FINDING-001 全天 150 秒週期卻 120 秒判 stale | 保留 sample 真實 source/tracking mode/session；只有確定被動背景 sample 使用 180 秒，其餘 120 秒；顯示實際 capturedAt 年齡 | locationFreshness、groupStatePatches、groupServiceBehavior |
| 11/20 離線 Solo 失敗 | SQLite 狀態與 durable intent 原子保存，同 UUID 重播，本人授權，確定拒絕才 rollback | durableSolo、durable_solo_refresh_receipts SQL |
| 34–37 刷新普通新位置被算 ACK、冷卻被延後 | 精確 requestedAt/version ACK ledger；冷卻從 server deadline 計算；ACK endpoint 不可用立即停止空輪詢並明確呈現 | refreshExactAcknowledgements、refresh SQL |
| 33/38 OFF 或撤權時 refresh await 競態 | GPS 及 upload await 後再次驗分享權限，未授權不 ACK；已存 refresh 由下一筆真 native sample 補送，無第二個 GPS owner | backgroundLocationRefreshBehavior、backgroundJourneyCoverage |
| 03/30 搜尋顯示與選取不符、duplicate key | 新 query 立即封鎖舊列，provider＋精確座標穩定識別，同點去重；關閉／重開 epoch 防舊選取控制新 sheet | destinationSearchLifecycle、placeSearchIdentity |
| 04/18/28 更換住宿後舊行程卡未更新 | 同日／main scope／open／舊名稱座標相符副本同步替換；受保護 transaction capability 限定 DB 座標變更，保留一般 immutable 規則 | durableTripAccommodation、reconcile_replaced_stay_cards SQL |
| 17/28 跨日 active 卡片隱藏 | 保留尚未完成的導航目標；日序以日曆日期計算，不用固定 24 小時；date picker 使用本地 date-only 解析 | tripDay、durableTripAccommodation；New_York/Los_Angeles fixtures |
| 27 到達 modal＋banner 重複、common.close 外露 | 去除重複中央到達 Alert，以 committed event notice 顯示；補雙語 close key及少量 clock skew容許 | notification presentation既有fixtures、synchronizedArrival |
| 29 主動離隊誤報踢除、舊邀請碼 generic | 主動離隊 intent 抑制踢除提示；保留 invalid_invite_code 專用錯誤 | 既有 membership/auth contracts＋型別／翻譯驗證 |
| 30 建議已保存仍顯示尚未同步 | 本地已保存採中性確認，不從 queue 對 server pending 作錯誤推論 | 既有 gather request durable fixtures |
| review/FINDING-002/003 iOS17 Tour、完成鈕 touch/AX | iOS17 RN fallback；iOS26 玻璃裝飾與 RN 唯一 Pressable 分開；disabled callback guard | tourCardLayout、sheetHeaderActionBehavior |
| review/FINDING-004／17 面板中斷後模糊空白、無法展開 | failed/tap/horizontal recognition 在 onFinalize 恢復最新 controlled detent；背景不重啟 spring | foregroundSheetLifecycle 的失敗→修復 fixtures |
| 31/32/44 長時資源增長與散熱 | 路線快取最大 24 筆／24,000 點／5 分鐘；失敗不留快取；熱狀態節流原生 delivery；balanced 使用 default activity，precision 才 fitness | routeRequestCache、Swift delivery policy；細節見子驗證文件 |

性能驗證目前證明的是資源上限與減少重複工作。2,000 筆各 1,000 點的 deterministic cache fixture 中，保留量從無界 2,000,000 點限制為 24,000 點；這不是實機 RAM、CPU、電池或溫度改善百分比。

進行中的導航目標維持不可變座標；更換每日住宿不暗中把現有 session 移到另一間旅館。SQL 同時排除 group active target 與所有 active session 引用，JS 可辨識的 group／authoritative activeGathering target 亦排除。snapshot 尚不包含獨立 server session 清單，因此不能把離線 projection 測試當作所有 session 組合證明。

模擬器長時 Debug footprint、主機 swap／三台錄影壓力不足以證明 App 洩漏，也不足以宣稱修復後真機散熱通過。新的 native log 仍需確認不再有 Record.swift 大量 actor warnings。原報告第 43 項外部 Apple 尋找／Google Maps對照、APNs／真機 background／整晚／熱量／原生 FPS 需保持未驗狀態。

## 驗證狀態

iOS 17 simulator native build＋install＋launch通過（XcodeBuildMCP，54.6秒incremental retry）；UI載入前須使用本地正確env/bundle。SQL113 migrations及兩份新fixture通過，既有daily accommodation／outbox SQL回歸亦通過。完整 Jest：319 suites／2,579 tests PASS；changed-function coverage 89.14%（門檻85%）；typecheck、lint、META_PARENT=287 meta、runtime alignment、Expo dependencies check PASS。獨立 review 發現並修正住宿 immutable trigger 衝突；新 SQL 必須部署、native module 必須重建 binary 才會生效。本次未修改正式 DB、未發布 OTA 或 TestFlight。
