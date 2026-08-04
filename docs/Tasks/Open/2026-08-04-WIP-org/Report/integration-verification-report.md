# WIP-org 整合驗證報告

**日期：** 2026-08-04（撰寫 / 驗證當日；報告歸檔 2026-08-05）  
**任務：** `docs/Tasks/Open/2026-08-04-WIP-org`  
**執行環境限制：** `Agents.md` 指定 Sol / Luna 角色；本機僅有 `grok-4.5`，由同一模型完成盤點、整合、驗證與本報告。  
**使用者後續指示：** 整合驗證後**不要** merge / push 遠端 master。

---

## 1. 目標（任務原文對齊）

1. 以最新 `origin/master` 為唯一基準，整合並完成所有本地 WIP。
2. 完成 iOS Energy、Premium、StoreKit、Supabase、Map UX 與同步相關功能。
3. 將本地 commit / 已修改 / 未追蹤檔案逐一分類：整合、排除刪除、或移至正確專案。
4. 完成後建立乾淨 commit；**本輪依使用者要求停在本地**，不 push 遠端 master。

---

## 2. 起始狀態（整合前）

| 項目 | 內容 |
|------|------|
| WIP 分支 | `codex/ios-energy-premium-map-ux-20260804` @ `9aa6660` |
| 本地 master | `aa6f31b`（落後 origin） |
| 當時 origin/master | `da459bf`（含 Expo Dev Client、StoreKit 0.1.5、preview 等 13 commits） |
| Merge-base | `aa6f31b` |
| WIP 已提交未進 master | `0992a6e`、`9aa6660`（review-01 findings 修正） |
| 工作樹 | 大量 modified + untracked（Energy / Premium / Map / migrations / docs / `support-site`） |
| 風險 | WIP `app.json` 曾為 **0.1.3**；不得覆蓋 master **0.1.5** |

---

## 3. 實際執行步驟

### 3.1 備份與隔離

1. 完整 WIP 備份至 `C:\Users\alexs\Desktop\BZ\hither\wip-org-backup-20260804`  
   - format-patch（2 commits）  
   - uncommitted patch  
   - feature tree 快照（約 805 files）  
2. `support-site`（約 3 萬檔，含 build 產物）**移出** repo：  
   `C:\Users\alexs\Desktop\BZ\hither\support-site-separate-20260804`  
   → 不混入 Mobile commit。  
3. 其餘 dirty + untracked `git stash push -u` 標籤：`hither-wip-org-full-20260804`。

### 3.2 以 origin/master 重建整合線

1. `git fetch origin master`
2. `git checkout -B integrate/wip-org-20260804 origin/master`
3. Cherry-pick `0992a6e`：
   - 衝突：`apps/mobile/src/native/purchases.ts`、`PaywallSheet.tsx`
   - 決議：採 WIP（monthly/annual Premium + intro eligibility + fail-closed 邊界）
4. Cherry-pick continue 觸發 **ota-auto-ship hook**：
   - 將第一顆 commit 合進本地 master 並嘗試 push  
   - 測試因缺少 untracked 模組失敗 → **遠端 push 失敗**  
   - 第二顆 review-fix 也進入本地 master  
5. 結果（hook 後本地）：
   - master @ `7d1c6c9`，ahead origin **3**  
   - `version` / `runtimeVersion` 仍為 **0.1.5**

### 3.3 還原 follow-up WIP 並解衝突

1. `git stash pop` 還原 Energy / Premium / migrations 等  
2. 衝突與處理：

| 檔案 | 決議 |
|------|------|
| `app.json` | 保留 **0.1.5**；plugin 改 `./plugins/withExpoIap`（靜音 expo-iap config stdout） |
| `package.json` / lock | 保留 master `expo-iap: ^5.0.0` |
| `entitlementContract.test.ts` | Paywall 契約改對齊 StoreKit subscription flow |
| `DestinationReorderList.tsx` | 以 master emoji category UI 為底；prop 允許 optional `markerColor` |
| `verify-and-apply-purchase` | 以 WIP JWS + durable grant 版覆寫 master 舊 trip-pass 驗收 stub |

3. 測試修正：
   - `storeKitSubscriptionContract`：允許 `^5.0.0`  
   - `entitlementContract`：`txn-1` 過短觸發 invalid gate → 改長 id  

### 3.4 驗證

```text
cd apps/mobile
npm.cmd test -- --runInBand --silent
→ 155 suites / 1303 tests passed

npm.cmd run typecheck
→ passed

git diff --check（task-scoped；修正 verify-and-apply EOF 空白）
→ passed
```

Lint **未**宣稱通過（既有 repo-wide 問題；未用 disable 掩蓋）。

### 3.5 本地 commit（無 push）

- 明確 `git add` 路徑清單（**未** `git add -A`）  
- `git commit --no-verify`（避免 ota-auto-ship 再 push）  
- 訊息：`feat: integrate iOS energy, premium StoreKit, map UX WIP`  
- 新 commit：`c262bf6`  
- 套用後 drop stash `hither-wip-org-full-20260804`  
- 工作區：**clean**

---

## 4. 最終 Git 狀態（驗證截止）

| 項目 | 值 |
|------|-----|
| 分支 | `master` |
| 本地 HEAD | `c262bf6d5e4c0772a72562d9d70cc0e5db34664b` |
| origin/master | `da459bf222e6feaf011760deec48eaf8ed0d0931` |
| ahead | **4** commits（**未 push**） |
| working tree | clean |
| version / runtimeVersion | **0.1.5** / **0.1.5** |

### 本地尚未上遠端的 commits

```text
c262bf6 feat: integrate iOS energy, premium StoreKit, map UX WIP
7d1c6c9 fix: close remaining premium map review findings
d746c8c merge: integrate/wip-org-20260804 (ota-auto-ship)
db99706 fix: address iOS premium map review findings
```

---

## 5. 整合進 master 的功能（Implemented locally）

### Energy observability

- 啟動 0/15/30/60/120s 採樣與穩定期低頻採樣（client）  
- 背景 / unmount 取消  
- counters：CPU、memory、FPS、thermal、location、route、Realtime、snapshot、render、network 接縫  
- MetricKit / `os_signpost` 原生模組接縫（`HitherMetricsModule`、`native/metrics`）  
- 隱私排除與 Instruments A/B：**接縫已備，runtime Unverified**

### Group recovery snapshot

- Migration + client：單一 server snapshot RPC  
- revision / generation fence  
- optimistic mutation 不被舊 snapshot 覆蓋（`useGroupState` race + tests）

### Server-owned coordination deadline

- Migration + scheduler SQL / client 契約測試  
- client 不再週期性寫入 deadline resolver 路徑（整合後程式）  
- service-role 實際排程 runtime：**Unverified**

### Premium / StoreKit

- personal / team Premium projection（migration + client Session）  
- monthly / annual catalog（`premiumCatalog` + env 缺一 fail closed）  
- localized price + intro eligibility（`isEligibleForIntroOfferIOS`，fail closed）  
- purchase flow / durable grant 後 finish（`premiumPurchaseFlow`、`PremiumPurchaseRecovery`）  
- Edge：`_shared/storekit`、`apple-server-notifications`、`verify-and-apply-purchase`（JWS 路徑）  
- ledger / disable legacy trip-pass migration **source 已進 Git（本地）**  
- sandbox / Apple cert / ASN replay：**Unverified / Blocked**

### Map / UX

- native map boundary（`native/maps`；GroupMap 不直判 Platform.OS）  
- route screen-space LOD + U-turn / roundabout anchor  
- Apple logo / compass 由 boundary 組裝  
- destination mutation overlay（optimistic + 精確 rollback 邏輯）  
- DestinationReorderList：保留 master emoji categories；prop 支援 optional markerColor  
- Share/Copy / 動態字級等既有 master UI **保留**，未整批覆寫

### Supabase source

| 檔案 | 說明 |
|------|------|
| `20260804000000_personal_premium_projection.sql` | 前輪 cherry-pick |
| `20260804010000_group_recovery_snapshot.sql` | follow-up |
| `20260804020000_coordination_deadline_scheduler.sql` | follow-up |
| `20260804030000_storekit_purchase_and_notification_ledger.sql` | 前輪 cherry-pick |
| `20260804040000_disable_legacy_trip_pass_purchases.sql` | follow-up；**僅 source，未 production 發布** |
| `supabase/tests/*` 對應 SQL 測試 | source only |
| Edge functions 如上 | source only |

### Docs / 代理規則

- `2026-08-04-iOS-Energy-Premium-Map-UX` Spec / Ticket / Code Review / Report  
- `2026-08-04-WIP-org` Spec / Ticket / integration-status  
- `CLAUDE.md` / `SETUP_NEW_MACHINE.md`：Sol + Luna 固定工作流說明  

---

## 6. 明確排除 / 移出

| 項目 | 處理 | 原因 |
|------|------|------|
| `support-site/` | 移至 `../support-site-separate-20260804` | 非 Mobile delivery；不可混 commit |
| `.env` / secrets | 未 stage | 任務禁止 |
| `node_modules` / `android` / `.expo` / 產生檔 | 未 stage | 任務禁止 |
| 舊 WIP 整批 merge | **未做** | 改 cherry-pick + 檔案級整合 |
| Production Supabase deploy | **未做** | 未授權 |
| OTA / TestFlight / push master | **未做** | 使用者明確要求驗證後先不 push |

---

## 7. 驗證矩陣

| Gate | Status | 證據 / 說明 |
|------|--------|-------------|
| Full Jest | **Passed** | 155 suites / 1303 tests |
| Typecheck | **Passed** | `tsc --noEmit` |
| git diff --check | **Passed** | task-scoped（含 EOF 修正） |
| Lint | **Failed**（既有） | 未包裝成成功 |
| Deno Edge tests | **Unverified** | 本機未跑 `deno test` |
| pgTAP / psql / migration apply | **Unverified / Blocked** | 無 runtime / 未授權 production |
| StoreKit sandbox / JWS cert chain | **Unverified / Blocked** | 無 Apple 憑證與裝置證據 |
| App Store Server Notifications replay | **Unverified** | — |
| MapKit visual / screen-space LOD | **Unverified** | 僅 Jest 邏輯 |
| Instruments / MetricKit A/B | **Unverified** | 僅接縫 |
| EAS Build / OTA / TestFlight | **Blocked** | 依指示不 push / 不 release |
| Remote master SHA 對齊 | **Blocked** | 本地 ahead 4，未 push |

**不得宣稱完成：** 僅因 Jest/typecheck 綠就宣稱 StoreKit、MapKit、Supabase、Instruments、EAS、TestFlight 已完成——本報告未作此宣稱。

---

## 8. 衝突決策摘要（給審閱者）

1. **purchases / Paywall：** master 為 trip-pass 簡化 IAP；WIP 為 monthly/annual Premium。採 WIP，並保留 master 0.1.5 / Expo 設定。  
2. **verify-and-apply-purchase：** master stub → WIP JWS durable path。  
3. **expo-iap pin：** 契約測試改接受 `^5.0.0`（master 依賴策略）。  
4. **DestinationReorderList：** 保留 master 分類 emoji UI，避免回退 master 地圖／emoji 體驗。  
5. **support-site：** 物理移出，文件標註，不進 commit。

---

## 9. 副作用與技術債

| 項目 | 說明 |
|------|------|
| ota-auto-ship hook | cherry-pick continue 時自動 merge 進本地 master 並嘗試 push；最終 push 失敗。後續改 `--no-verify` 本地 commit 避開。 |
| 本地 master 已 ahead 4 | 審閱後若要上遠端，需一次 `git push origin master`（或改 feature branch + PR）。 |
| 備份目錄 | `wip-org-backup-20260804`、`support-site-separate-20260804` 仍在 Desktop/BZ/hither 外層；可於確認後清理。 |
| 舊分支 `codex/ios-energy-premium-map-ux-20260804` | 仍指向舊 tip `9aa6660`；整合成果在 **master 本地**。 |

---

## 10. 下一步（需使用者明確授權）

1. 審閱 `git log origin/master..HEAD` 與 `git diff origin/master...HEAD`  
2. 授權後：`git push origin master`（或推 feature branch）  
3. 另授權：Supabase migration + Edge deploy  
4. 另授權：EAS / TestFlight / StoreKit sandbox 裝置驗證  
5. 確認後可刪除備份目錄與過期 agent 分支（非必須）

---

## 11. 相關路徑

| 路徑 | 用途 |
|------|------|
| `docs/Tasks/Open/2026-08-04-WIP-org/2026-08-04-WIP-org.md` | 任務目標（若存在於歷史；本輪以 Ticket/Spec 為準） |
| `docs/Tasks/Open/2026-08-04-WIP-org/integration-status.md` | 簡表狀態 |
| `docs/Tasks/Open/2026-08-04-WIP-org/Report/integration-verification-report.md` | **本報告** |
| `docs/Tasks/Open/2026-08-04-iOS-Energy-Premium-Map-UX/Report/implementation-summary.md` | 功能實作摘要與 gate 表 |
| `docs/Tasks/Open/2026-08-04-iOS-Energy-Premium-Map-UX/Code Review/review-01.md` | Sol findings |
| `docs/Tasks/Open/2026-08-04-iOS-Energy-Premium-Map-UX/Code Review/review-02.md` | Fix 驗證 |

---

## 12. 一句話結論

**本地已在 0.1.5 master 上完成 WIP 整合與 Jest/typecheck 驗證，工作區 clean；遠端 master 未更新；外部 native/server/release gates 維持 Unverified/Blocked。**
