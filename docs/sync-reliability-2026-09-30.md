# 同步修復與驗證紀錄 — 2026-09-30

直接修改既有 master，基準 `03c68b8c45cb35a05b22b03af42daa9fc7957d01`。經 Astra medium 審查後，整合遠端 `9fcce37583b35ef97d5c5eb3a498278335805179`，merge commit 為 `3a0c51022f708aa449af1e0ebf770917efd7de2c`。本文件區分已執行的無 UI 驗證、正式後端驗證與尚未證明的原生行為。

## 根因與修正

1. **位置與集合點走不同管線**：集合點 Realtime 正常並不能證明位置上傳成功。原本前景位置仍走延遲 flush、精準設定未傳到底層；outbox 的回傳結果即使沒有接受本次事件，也被上層當成上傳成功。現在以本次 event ID 出現在 acceptedIds 才確認成功；正常前景移動政策為約 5–10 秒、靜止 60 秒，停止 GPS 事件後仍有到期重試。
2. **手動更新相依方向錯誤**：自己 GPS 失敗／等待與群組請求冷卻，阻擋了讀取其他成員。現在共用 `refreshTeamLocations` 同時啟動伺服器讀取、自身定位／上傳及隊員請求；冷卻只限制請求。UI 分別報告讀取、上傳及回覆數。
3. **復原覆寫新資料**：讀取失敗重新載入舊 SQLite、集合點 optimistic fence 保留整份成員、舊快照覆蓋 Realtime 等路徑會造成各裝置不同。現在只在冷啟動使用快取，依 server receipt 合併位置；無位置快照帶伺服器觀測時間，避免「第一筆位置已收到，舊空快照又把頭像擦掉」。離隊與停止分享仍是明確撤除。
4. **無回呼／漏訊息缺少有效恢復**：前景 30 秒核對，SUBSCRIBED 重連與前景恢復補讀；HTTP 與 recovery deadline 釋放鎖。MapKit 無樣本時用有界單次新定位恢復，不把 cached 座標重新蓋時間，不另開持續 watcher。
5. **時間語意混用**：自己用本機 GPS、其他人用伺服器資料，造成「我看剛更新、別人看很久前」。分享列全用伺服器確認資料，分開 capturedAt（採樣）／uploadedAt（伺服器接收）；lastUpdated 保留既有採樣時間語意；freshness 用採樣時間，讀取不改時間，並由 snapshot 的 server time 校正觀看手機的時鐘。藍點仍是本機定位。讀取失敗保留資料並標示失敗。
6. **RPC 假接受**：舊 sample 的 UPSERT 沒更新位置，RPC 卻回 accepted；重複 event 又可能刷新 receipt。新 RPC 拒絕 stale／不合法時間與座標，duplicate 不重寫位置。被拒絕的 event INSERT 一併回滾，重送不能變成功；同一 ID 不接受不同 payload。
7. **尾端事件丟失**：抵達、集合請求與投票原本節流期間直接 return。現在延後補讀；投票 responses 讀取失敗保留既有票數。分隊邀請、導航及例外來源补上前景／重連／30 秒核對；切隊清除舊模型並阻擋遲到回應。
8. **位置跨帳號佇列**：新位置在 SQLite payload 保存 actorId，上傳前拒絕另一帳號的事件；登出、刪帳號、切換登入身分先撤銷位置存取並清除佇列。明確撤銷分享的清除屬隱私行為，不是網路失敗重試。
9. **粒子時間無界**：保留遠端 CPU Skia Path 外觀，以有界 twinkle 相位與每顆粒子的位置 wrap 持續循環；可見且 active 時持續、背景暫停、恢復續播，保留 Reduce Motion。MemberMarker 同時提供最新 declarative coordinate，不只依賴原生動畫命令更新位置。

10. **刪隊 trigger 相互衝突**：批次清理 memberships 時，空團隊已被刪除，Premium trigger 仍重建該團隊 projection，造成 FK 失敗。共用 recompute 函式先鎖定／檢查 parent；不存在就返回，既有團隊照常計算。PGlite 與真實 Dummy 清理皆通過。

11. **活動集合點刪除遺漏 session**：整合遠端 durable v3 後，正式 delete 入口未傳原始 sessionId，伺服器正確拒絕刪除活動目的地。兩個 UI 入口改用既有 session resolver，Service 與共享 outbox 原樣持久化；不於重送時抓較新的 session，避免舊離線意圖刪掉新集合。真實 Smoke 揭露此問題，Service／outbox 測試與 Astra 複審已通過。

這些是由程式路徑、失敗回歸與 Dummy 重現支持的原因；沒有三台使用者手機的原始 trace，因此不把其中單一路徑宣稱為當時唯一原因。

## 全 App 同步對照表

| 資料 | 權威／寫入 | 接收及恢復 | 本次證據／剩餘邊界 |
|---|---|---|---|
| 隊員位置與自己分享列 | member_locations、ingest_location_batch；SQLite outbox | Realtime patch、30 秒 recovery、前景／重連／手動；逾時與退避最多 60 秒 | Hook、outbox、PGlite、真實 HTTP／Realtime；背景執行受 iOS 限制 |
| 本機藍點 | timestamped MapKit／Expo sample | 單一持續來源，單次 watchdog；精準設定傳遞 | localLocationFeed、locationPolicy；原生畫面未驗證 |
| 定位請求 | location_refresh_requests／pending，server requested_at，版本 ACK | 推播是提示；前景亦每 30 秒 recover pending，單次 flight | GPS／上傳／ACK 失敗不記 completed；live 使用正式 recovery 函式 |
| 成員集合、角色、分隊、旅程目標 | memberships／groups／subgroups／recovery snapshot | 即時事件＋30 秒核對；not_member 撤除 | 缺位置首筆、跨團隊拒絕、離隊與切隊實測 |
| 集合點／行程／每日住宿 | itinerary_items／daily_accommodations；CoreData versioned operations／服務 | snapshot、Realtime、前景 flush；衝突不再永久遮住伺服器 | coreDataLocalFirst、真實新增／刪除；非 outbox 的編輯失敗仍需 UI 重試 |
| 抵達 | destination_arrivals；arrivalSync／core outbox | optimistic row、冪等操作、延後補讀、30 秒核對 | arrivalSync／arrivalRpc、實際 true→false→true 讀回收斂 |
| 集合點提案 | gather_point_requests RPC | leader scope read、Realtime 尾端補讀、前景／重連 | 真實提交與隊長讀回；離線提交不假裝成功 |
| 協調投票 | coordination_requests／responses | Realtime、尾端延後補讀、前景／30 秒核對；失敗保留票 | Hook 保留票／尾端事件；真實改票與離線觀察者恢復 |
| 導航 session／個人回覆 | navigation_sessions／member_states、CoreData reply outbox | version fencing、獨立 channel、重連／前景／30 秒 | navigationSessionLifecycle、terminal mutation、coreData tests |
| 分隊邀請 | subgroup_invites RPC／RLS | 自己帳號訂閱、前景／重連／30 秒 | 真實 invite→accept→merge；通知僅 best effort |
| 隊長例外來源 | navigation states、arrivals、commands need_help | 初次讀取、即時事件、前景／重連／30 秒 | organizerExceptionContracts；**ack／resolve 處理紀錄仍是本機 AsyncStorage** |
| 位置分享偏好 | 本機 consent 優先、member_privacy_settings | pending sharing 持久化，前景／成功 recovery 重送；拒絕晚到 enable | locationSharingSync／privacy tests、真實停止分享 |
| 帳號／profile／團隊清單 | Auth、profiles、SessionContext；user-keyed cache | auth change、明確 refresh／操作後刷新 | 現有 auth／cache tests；不是持續 30 秒跨裝置同步 |
| 收藏地點／已訪問地點 | account-owned Favorites／Waypoint RPC | 開啟或操作後讀取；DB uniqueness／RLS | 現有 mapper／service tests；不保證另一裝置畫面即時刷新 |
| Premium／商店／權益／餘額 | server entitlement／store transactions，非 UI 推論付款 | user-keyed projection／查詢／購買或回復後 refresh | 既有 entitlement tests；本次未做真實付費交易 |
| 通知／Live Activity | 推播／原生呈現，來源仍為伺服器狀態 | token upsert、原生恢復／前景更新；不拿通知成功當資料 ACK | 現有契約測試；APNs 到達與原生顯示未實機驗證 |
| 診斷／效能日誌 | 本機 bounded queue、批次服務 | consent gate、批次／重試 | 既有 diagnostics tests；日誌失敗不反向表示群組同步失敗 |
| UI 設定／例外處理狀態 | 本機 preferences／AsyncStorage | 本機持久化 | 本機用途；不是每個設定都有伺服器同步 |

## 尚存缺口與選擇

- 隊長例外的「已處理／重新開啟」目前只在這台手機保存。若要求隊長換機也一致，建議新增 group＋actor＋rootCauseKey 的 versioned server table；若只作個人工作清單，保留現況並標示本機即可。本次沒有擅自把個人處理紀錄變成全團隊共享。
- 收藏、profile、Premium／商店不走隊伍位置的 30 秒輪詢。建議維持開啟／操作後核對；只有需要雙裝置同時停留該頁時，才加入該頁的 Realtime＋前景核對，避免全 App 無差別輪詢。
- 裝置休眠、被強制終止、OS 不提供 GPS 時，無法保證五秒新樣本；讀取也不能替另一台手機製造新位置。會保留舊位置與採樣時間／失敗狀態。5–10 秒是前景且有有效樣本、正常網路的政策目標，無 UI 測試不能證明真機耗電與 OS 排程。
- collection sampling timestamp 仍來自感測器；超過伺服器兩分鐘的未來樣本被拒絕，逾 24 小時不再重送。觀看端時鐘校正不會把延遲上傳的舊樣本變成新樣本。
- lint 仍有 669 個警告、0 errors；本次沒有把無關歷史警告一起大規模改寫。完整 Jest 與 85% 變更函式覆蓋率門檻均已通過。

## 測試分層與可重跑命令

正式 UI 與測試共用 refreshTeamLocations、useDeviceLocation、useGroupState、locationOutbox、merge／patch 及 LocationService。Jest 替換 GPS／AppState／儲存邊界；真實 Smoke 使用六個獨立 Node process、Supabase session、SQLite、cache 與 queue，沒有共用一個全域狀態冒充手機。真實 Smoke 不掛 React Hook；Hook 生命週期另由 react-test-renderer 執行。

從 apps/mobile：

```powershell
npx.cmd tsc --noEmit
npm.cmd run lint
node scripts/check-test-meta.mjs
node scripts/verify-runtime-alignment.mjs
node node_modules/jest/bin/jest.js --runInBand --silent --forceExit
$env:COVERAGE_BASE='9fcce37583b35ef97d5c5eb3a498278335805179'
node scripts/check-changed-coverage.mjs
node scripts/location-smoke.cjs --live --admin --duration=300
```

`--admin` 僅用 Supabase CLI 已授權的管理金鑰建立與清理本次 ID；不把 service role 傳給 worker，不把密碼或 token 放入報告。需要明確的 `--live --admin` 才會執行；早期 anonymous authenticated 批次遇到註冊限流，因此正式可重跑入口改用管理建立。清理先刪本次 memberships、再刪本次 groups、最後刪本次 users，並由新的 Premium parent guard 避免已刪團隊被 trigger 重建 projection。輸出 temp evidence 目錄；report.json 保存資源 ID、階段、差異及清理，calls.jsonl 保存往返結果／事件 ID／時間（登入憑證除外）。失敗仍清理本次資源。

從 repository root，以獨立暫存安裝 PGlite（不更動 App dependencies）：

```powershell
npm.cmd install --prefix .sync-test-runtime --no-save --package-lock=false @electric-sql/pglite@0.5.8
node supabase/tests/member_location_sync.mjs .sync-test-runtime/node_modules/@electric-sql/pglite/dist/index.js
```

PGlite 執行實際 migration 與 RPC，使用最小 auth／通知 fixture 和 RLS 測試資料；它不代表真實 Realtime，正式權限另由各帳號 live session 驗證。固定亂序種子：24301、20260930、731。相位測試五百萬步，跨千次週期；粒子位置另跑十萬次有界更新與暫停／恢復。

| 必測情境 | 證據 |
|---|---|
| 六 actor、兩團隊、移動／並發、首筆缺位置補回 | teamLocationIntegration、live Smoke |
| 位置事件丟失但集合點事件正常；30 秒自動恢復 | live dropped-location + automatic reconciliation；useGroupStateRecoveryRace |
| 同時按更新、GPS 失敗、冷卻、舊 sample | shared refresh action＋localLocationFeed＋live |
| HTTP 永不返回／拒絕／部分接受 | requestDeadline、locationOutbox、RPC invalid／stale、backgroundLocationRefreshBehavior |
| 沒有新 GPS 時重送、程序中止／相同 SQLite 重啟 | live 正式 outbox wrapper 自動計時器；outbox failure／restart tests |
| 亂序快照／Realtime、首次 null 位置、撤除不復活 | seeded merge／patch、useGroupState race |
| 停分享／離隊／切隊／帳號切換 | privacy／LocationService actor fencing／Session cleanup；live sharing、leave、team switch |
| 離線觀察者的抵達、改票、集合請求、分隊 | live workflows；arrival outbox／coordination hook tests |
| 不同觀看手機時鐘／延遲 sample | server offset hook assertion、server requestedAt、SQL stale/future/duplicate tests |
| 粒子無限循環、暫停與恢复 | starfieldPhase test；GPU 與 MapKit 實際畫面未實機驗證 |

## 後端與發布

已部署 `20260929164531_reliable_member_location_sync`、`20260929173500_location_rejection_idempotency`、`20260929175500_premium_projection_deleted_group_guard` 到 Hither `htqrucnjafhhvxdqslbv`。db push dry-run 被既有歷史差異擋住，因此只執行這三份審查過的 SQL，並只 repair 對應三個版本為 applied；沒有 reset 或重跑其他 migration。本次另部署 `20260929183149_itinerary_version_deleted_group_guard`，修正遠端整合後真實清理測試發現的 itinerary version trigger 刪隊 FK 問題。正常寫入仍遞增版本，刪除 parent 不重建版本。此份經 MCP apply_migration 部署，檔名與實際 migration history 版本一致。此次修復沒有 Edge Function 改動。

Security advisors：0 ERROR；8 筆 RLS-without-policy INFO、1 anon SECURITY DEFINER、54 authenticated SECURITY DEFINER、52 anonymous-access policies、1 leaked-password protection 未啟用 WARN。RPC 型功能與訪客使用本來就會觸發部分警告；不能因此自動撤銷現有功能權限。密碼洩漏保護屬另項 Auth 設定，未擅改。

Production channel `production` 指向同名 branch，production runtime 為 0.1.8。使用者確認已在 2026-09-22 的原生變更 commit `9fcce37583b35ef97d5c5eb3a498278335805179` 後完成本地 iOS build；該 commit 至今沒有後續原生輸入變更。已發布並以 `eas update:view` 回讀確認 iOS OTA：group `280b0857-5aec-4aa2-bd20-796bbac5266b`、update `01a0ee92-2dd5-7d5c-8959-6fda54ca2cd0`、runtime `0.1.8`、branch `production`、Git commit `47c99f3c432adb6b0f6a014c10f7d3ba62de4775`。

最終完整 Jest：293 suites、2336 tests 通過、0 失敗；TypeScript、lint（0 errors／669 warnings）、test meta、runtime alignment 通過。對整合的遠端 SHA 計算變更函式 coverage 為 86.10%（601／698），通過 85% 門檻，lines 91.66%。Coverage runner 改串流輸出，避免 React 診斷超過 spawnSync buffer 時測試被中止；未調降門檻。npm ci 安裝後 audit 為 0 vulnerabilities。

## Astra medium 審查與整合回歸

- 空快照的 generated_at 不是刪除版本：已移除以它拒收真實新位置的條件，避免 snapshot 後 commit 的位置永遠被排除；明確停止分享仍生效。
- 隊長例外來源只取最新 50 筆：補讀改按使用者合併最新訊號，避免較早尚未解決的求救被其他人的訊息擠掉。
- MapKit 動畫必須用 capturedAt／採樣 lastUpdated，不能以剛收到的 uploadedAt 將舊 GPS 當新樣本。
- 另外補上 UI refresh 整體 deadline、缺少 actorId 的持久化事件拒絕、舊帳號 refresh promise fencing，以及 stale_version 僅補讀重試一次後呈現衝突。
- 上述根因已加回歸測試；最終 Astra medium 複審無新的確定問題。Hook tests 實際掛載 organizer／subgroup recovery hooks；navigation tests 執行正式 service scope／訂閱回呼。
- 整合遠端 durable add 後，Smoke 改等待另一成員的伺服器 snapshot 確認新增再抵達；刪除後也逐一讀回所有成員確認消失，不把 optimistic function 返回視為遠端成功。六個 worker 使用正式 authenticated transport、auth recovery 與 core sync runtime。抵達測試使用正式 UI 的 enqueueLeaderGatheringStart、arrivalSync 與 setDestinationArrivalAt，從另一成員讀到導航 session 後綁定操作；缺少 session 的拒絕保留為失敗證據。分隊接受／合併逐端核對 subgroupId；抵達先確認撤回落庫，再確認最後 true 在所有端一致。合法並發定位可向前更新，但被拒座標不得生效、時間不得倒退。

最終真實 run `IqW1Gu`：62 checks 全數通過、0 失敗；穩定性 302661 ms／48 cycles，漏掉位置事件在 17350 ms 自動補讀恢復。該輪 6 個帳號、2 個團隊清理成功；包含全部歷次失敗輪次，已逐 ID 核對 135 個測試帳號與 44 個測試團隊，殘留均為零。

最新 Live Smoke、失敗輪次與清理核對結果見 [驗證資料](sync-reliability-evidence.json)。原始 calls.jsonl 保留於各輪 Temp evidence 目錄；帳號密碼與 session 不寫入版本庫。commit／remote SHA 見交付回覆。
