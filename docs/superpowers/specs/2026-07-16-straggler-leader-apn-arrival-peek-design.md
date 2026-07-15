# 脫隊示警（隊長 1 對多 + APN）、抵達管理獨立頁、Peek 單人排版

**日期：** 2026-07-16  
**狀態：** 待實作（方案 A 已確認）  
**範圍：** 脫隊判定與推播、抵達管理導覽、BottomSheet peek header

## 1. 目標

1. **脫隊示警**改為隊長對隊員的 **1 對多** 本地距離判定；超出門檻後由隊長端觸發 **APN**，通知群組全員（含隊長）。隊員端不跑距離邏輯、不發本機脫隊通知。
2. **脫隊 toggle／距離檔位** UI 樂觀更新（本地立刻反應），背景同步群組設定；失敗回滾。
3. **抵達管理**從路線 overlay 內嵌區塊抽出為 **獨立頁**；入口仍在路線內。
4. **Peek** 僅一人時不顯示「成員」文案；動作鈕靠右、垂直置中，修正偏下與上下間距不均。

## 2. 非目標

- 不改集合點抵達距離（≤30m）或 journey／Live Activity 進度公式。
- 不做伺服器端定期算距離（cron／Edge 批量 Haversine）。
- 不重做 BottomSheet detent 系統或整張 Map 導覽架構。
- 不在本規格重做 Freemium 脫隊距離檔位規則（免費鎖 500m 維持）。
- 不強制修正既有 DB trigger 將 solo／status 變更映射為 `straggler` 的語意（見 §3.7）；距離脫隊不依賴該路徑。

## 3. 脫隊示警

### 3.1 現況問題

| 項目 | 現況 | 問題 |
|------|------|------|
| 參考點 | 每台裝置以「我的座標」呼叫 `useStragglerAlerts` | 多對多，非隊長對隊員 |
| 通知 | 每台本機 `scheduleLocalNotification` | 隊員也在判、也在發 |
| Toggle | `StragglerConfigSection` 有 local state，但 `onPersist` 後 `refresh()` | 體感 lag |
| APN | `category: straggler` 已存在，但距離脫隊未走正式 fan-out | 與產品敘事不符 |
| DB trigger | `on_membership_presence_change` 在 solo／status 變更時發 `straggler` | 與距離脫隊語意不同 |

### 3.2 判定模型（僅隊長裝置）

**觸發條件（全部成立才跑）：**

- 目前使用者 `role === 'leader'`
- `group.stragglerAlerts === true`（含樂觀本地值）
- 隊長有有效 GPS（`fromCoords`）
- 主隊 eligible 隊員至少 1 名（見下）

**參考點：** 隊長 GPS（`fromCoords`），不是集合點、不是 flock 重心。

**Eligible 隊員：**

- 有 `coordinates`
- 非 `solo`
- 無 `subgroupId`（主隊）
- `userId !== leader.userId`

**門檻：** `group.stragglerThresholdM`（預設 500；Pro 可改 300／500／1000／2000）。

**Hysteresis（維持）：**

- 進入：距離 > `thresholdM`
- 解除：距離 ≤ `thresholdM * 0.8`
- 仍在 release band 內維持 alerting，避免邊界抖動

**純函式調整（`findStragglers`）：**

- 新增／明確 `leaderUserId`（或 `excludeUserIds`）：參考點為隊長時，**隊長本人永不列入** straggler 結果。
- 移除「以觀眾自己為 target 的多對多語意」文件敘述；centroid fallback 僅在「呼叫端未提供 target」時保留給單元測試／工具，**產品路徑必須傳隊長座標**。
- 單人組（eligible < 1 名隊員，或總 eligible < 2）→ `[]`。

### 3.3 通知路徑（方案 A + RPC）

客戶端**不可**直打 `send-push` Edge（僅 webhook secret）。正式路徑：

```
隊長本機 findStragglers + hysteresis
        │ 新脫隊 memberId（進入 alerting 集合的差集）
        ▼
RPC public.report_straggler(
  p_group_id uuid,
  p_member_id uuid,
  p_distance_m double precision default null
)
        │ security definer：auth.uid() 必須是該群 leader
        │ 目標 member 必須仍在該群 memberships
        ▼
extensions.notify_push({
  category: 'straggler',
  group_id,
  sender_id: leader,
  member_id: 脫隊者,
  distance_m?: …,          -- 可選，供 copy
  member_name?: …          -- 可由 RPC 查 profiles 後填入 payload
})
        ▼
send-push Edge → APN 一般通知（+ 既有 live activity fan-out 若適用）
```

**客戶端呼叫：** `GroupService.reportStraggler(groupId, memberId, distanceM?)` → `supabase.rpc('report_straggler', …)`。  
失敗：log／可忽略（不阻塞 UI）；下次仍 over threshold 且仍在 hysteresis「新進入」邏輯外時，**不重送**（見 §3.4）。

### 3.4 去重與生命週期

- 沿用 `useStragglerAlerts` 的 `alertingRef` + MapScreen `lastStragglerIdsRef` 語意：  
  **僅在 userId 新進入 alerting 集合時**呼叫一次 `report_straggler`。
- 解除後再次超出才再報。
- 不在伺服器做 cooldown（v1）；若 APN 重複，先查客戶端差集邏輯。

### 3.5 角色行為矩陣

| 角色 | 距離計算 | 本機 straggler 通知 | 觸發 RPC | 收 APN |
|------|----------|---------------------|----------|--------|
| 隊長 | ✅ | ❌ 移除 | ✅ | ✅（含自己） |
| 隊員 | ❌ | ❌ | ❌ | ✅ 只收隊長觸發 |
| Solo 成員 | 不參與判定 | — | — | 依既有 solo 過濾（通常不收一般 alert） |

MapScreen 變更：

- `useStragglerAlerts` **僅在 `isLeader` 時**啟用；非隊長直接 `stragglers = []`。
- 刪除（或不再呼叫）非隊長的 `notifications.scheduleLocalNotification` straggler 路徑。
- 隊長成功路徑以 APN 為準，**不再**對同一事件再發本機 straggler 通知（避免隊長雙響）。

### 3.6 send-push 行為調整

現況：一般 alert 排除 `sender_id`（meet-time 例外含 sender）。

**脫隊：**

- 與 meet broadcast 類似：`category === 'straggler'` 時 **收件含 sender**（隊長也要收到「誰脫隊」）。
- 仍套用 subgroup scope（主隊／小隊與既有 `inSenderScope` 一致）與 notification preferences（`journey` 欄，與現有 `prefColumn('straggler')` 一致）。
- Solo 成員是否排除：維持 Edge 現有非 meet 規則（排除 solo），除非產品之後要求 solo 也收脫隊——**本規格不改**。

**Copy（`messages.ts`）：**

```
title: 隊友已脫隊
body:  有 member_name →「{name} 已脫隊」
       有 distance   →「{name} 已脫隊（約 {formatted}）」可選
       否則 fallback →「一位隊友已離開主隊伍」
```

Payload 擴充（可選欄位，向後相容）：

- `member_name?: string`
- `distance_m?: number`（Edge 可只做簡單數字顯示，或僅供 data payload）

### 3.7 Toggle 樂觀 UI

`StragglerConfigSection`（工具分頁，僅隊長可見）：

1. Switch／Segmented 立刻更新 `localAlerts` / `localThreshold`。
2. 背景 `setStragglerConfig(groupId, enabled, thresholdM)`。
3. **成功後不呼叫整包 `refresh()`**（避免 sheet 重抓狀態造成 switch 回彈感）；以 props 的 server 值在 effect 中對齊即可（已有 `useEffect` sync）。
4. 失敗：回滾 local + `Alert`。
5. 仍寫入 `groups.straggler_alerts` / `straggler_threshold_m`（全隊同步設定，非純本機）。

MapScreen 的 `persistStragglerConfig` 拿掉成功路徑的 `refresh()`；錯誤仍 throw 給 section 回滾。

### 3.8 RPC 規格（migration）

```sql
-- public.report_straggler(p_group_id uuid, p_member_id uuid, p_distance_m double precision default null)
-- security definer, search_path = ''
-- 1. auth.uid() 必須存在
-- 2. memberships: caller role = leader, group_id = p_group_id
-- 3. memberships: p_member_id 在同 group
-- 4. 可選：groups.straggler_alerts = true，否則 no-op return
-- 5. 查 profiles.nickname → member_name
-- 6. perform extensions.notify_push(jsonb_build_object(...))
-- grant execute to authenticated
```

### 3.9 既有 membership straggler trigger

`on_membership_presence_change` 在 solo on 或 status→idle/offline 時發 `straggler`，語意是「狀態／solo」，不是距離。

**本規格：** 距離脫隊只走 `report_straggler`。  
**實作預設：** 不刪該 trigger（避免 scope creep）。若 QA 發現文案「隊友已脫隊」與 solo 衝突，另開小修把該分支 category 改名或停用。

### 3.10 邊界與限制

- 隊長無定位／App 被殺／背景被系統凍結 → 不判定、不推（接受；符合本地判）。
- 隊員座標過舊仍用庫內最後座標；不在本規格做 freshness 門檻。
- 隊長自己超出「相對於自己」的距離在數學上為 0，永不自報脫隊。

### 3.11 測試

- 單元：`findStragglers` 相對隊長座標；排除 leader／solo／subgroup／無座標；hysteresis 行為（既有 hook 測試可補 leader-only）。
- 合約：migration 含 `report_straggler`；send-push `straggler` 含 sender；messages 有 name。
- 行為：非 leader 不 schedule 本機 straggler；leader 新脫隊呼叫 RPC 一次。

## 4. 抵達管理獨立頁

### 4.1 現況

路線 `OverlaySheet`（`overlay === 'route'`）內嵌：

- section「抵達管理」
- 每個 destination 一列 → `setArrivalDestination` + `setOverlay('arrival')`（成員標記頁）

### 4.2 目標 IA

```
路線 overlay（集合點排序／新增／KML／請求…）
  └── 列：「抵達管理 ›」     ← 唯一入口（仍在路線內）
        └── 抵達管理頁（新 overlay）
              └── 各集合點列 → 既有成員標記頁（overlay === 'arrival'）
```

### 4.3 UI 細節

**路線 overlay：**

- 移除內嵌的 destination 抵達列表區塊。
- 隊長且 `destinations.length > 0` 時顯示一列入口：
  - 標題：`t('arrival.manage')`
  - chevron
  - 可選 trailing：已標記總數或「N 個集合點」（實作選簡單即可；建議顯示集合點數）。
- 點擊 → `setOverlay('arrivalManage')`（新 key），**不**關掉再重開的路由動畫要求；與其他 OverlaySheet 一致。

**抵達管理頁（新 `OverlaySheet`）：**

- `title`: `t('arrival.manage')`
- `done` 關閉 → 回到 `overlay === 'route'`（返回路線，而不是整棵關掉到地圖）。若實作成本高，可 `setOverlay(null)`；**建議返回路線**以符合「從路線進入」。
- Body：現有 destination 列表（標題 + 該點抵達人數 + chevron）。
- 點集合點 → `setArrivalDestination(dest)` + `setOverlay('arrival')`。
- 非隊長：不顯示入口與頁（與現況一致，抵達管理為 leader）。

**成員標記頁（既有 `arrival`）：**

- 邏輯不變（標記／撤銷抵達）。
- 關閉時：`setOverlay('arrivalManage')` 並可保留 `arrivalDestination` 清除或保留；**建議**關閉後回抵達管理列表並 `setArrivalDestination(null)`。

### 4.4 狀態

```ts
// overlay union 新增 'arrivalManage'
type Overlay = ... | 'arrivalManage' | 'arrival' | ...
```

### 4.5 測試／驗收

- 路線頁不再直接列出各點抵達管理列。
- 隊長可 路線 → 抵達管理 → 某點 → 標記成員。
- 返回鏈：成員頁 → 抵達管理 → 路線（或至少不卡死）。

## 5. Peek 單人排版

### 5.1 現況

- `sheetHeader`：左 `peekAvatarStack`（他人頭像；`others.length === 0` 時顯示 `t('map.tabMembers')`），右搜尋／⋯／頭像。
- 單人時左文案、右三鈕 → 左空右擠；使用者回報鈕偏下、上下間距不均。

### 5.2 規則

| 條件 | 左側 | 右側 |
|------|------|------|
| `others.length === 0`（僅自己） | **不渲染**「成員」文字；左側可為空 `View` spacer（`flex: 1`）以撐開右對齊 | 搜尋／⋯／頭像，**靠右** |
| `others.length > 0` | 頭像 stack（最多 6 +N）維持 | 同上 |

### 5.3 對齊與間距

- `sheetTitleRow`：`alignItems: 'center'`（已有）；確認子元素無單顆 `marginTop` 造成偏下。
- 三顆動作共用同一外框規格（寬高 46、圓角一致）；搜尋／⋯／頭像 **垂直中心對齊**。
- `sheetHeaderBlock` padding 上下對稱檢視；必要時微調 `paddingBottom` / actions 容器，使 peek 視覺質量心垂直居中於 header 帶。
- 不改 peek detent 高度演算法（仍由 header 量測）；改完後確認單人 header 高度穩定、無二次 remeasure hitch。

### 5.4 無障礙

- 單人時左側不再放「成員」假文案；右側按鈕既有 `accessibilityLabel` 足夠。
- 多人時 stack 維持 `accessibilityLabel={t('map.tabMembers')}`。

## 6. 檔案與變更對照（實作指引）

| 區域 | 主要檔案 |
|------|----------|
| 判定純函式 | `apps/mobile/src/utils/straggler.ts`、`__tests__/straggler.test.ts` |
| Hook | `apps/mobile/src/state/useStragglerAlerts.ts`（可加 `enabled`／`leaderUserId`） |
| Map 整合 | `apps/mobile/src/screens/MapScreen.tsx`（leader-only、RPC、peek、arrival IA、persist 無 refresh） |
| API | `apps/mobile/src/api/services/GroupService.ts`（`reportStraggler`） |
| i18n | 若需「返回」或人數文案微調；脫隊推播主 copy 在 Edge |
| Migration | `supabase/migrations/YYYYMMDD_report_straggler.sql` |
| Edge | `supabase/functions/send-push/messages.ts`、`index.ts`（straggler 含 sender） |
| 合約測試 | `productionPushMigration.test.ts` / gather 類契約若有掃 SQL 字串 |

## 7. 實作順序建議

1. `findStragglers` + 測試（leader 參考點／排除自己）  
2. Migration `report_straggler` + Edge copy／含 sender  
3. MapScreen：leader-only 判定 + RPC；移除本機 straggler 通知  
4. Toggle：persist 不 refresh  
5. 抵達管理獨立 overlay + 返回鏈  
6. Peek 單人 UI  
7. 合約／單元測試與手動驗收清單  

## 8. 驗收清單

### 脫隊

- [ ] 僅隊長裝置在成員超距時觸發一次推播  
- [ ] 隊員裝置不因本地距離發脫隊通知  
- [ ] 隊長與隊員皆能收到 APN（偏好未關 journey 時）  
- [ ] 文案盡量帶脫隊者名字  
- [ ] Toggle 切換無 1–2s 肉眼 lag；斷網失敗會回滾  
- [ ] 距離檔位仍寫入群組並同步  

### 抵達管理

- [ ] 路線內僅一列入口  
- [ ] 獨立頁列出集合點並可進入標記  
- [ ] 返回路徑合理（成員 → 管理 → 路線）  

### Peek

- [ ] 單人無「成員」字樣  
- [ ] 單人時三鈕靠右且垂直置中，無明顯偏下  
- [ ] 多人時頭像 stack 行為不變  

## 9. 風險

| 風險 | 緩解 |
|------|------|
| 隊長 App 不在線 → 無脫隊推播 | 產品接受；文件化 |
| 舊 trigger 與距離脫隊文案混淆 | QA 時監看；必要時另修 category |
| Overlay 返回鏈狀態機變複雜 | 明確 `arrival` / `arrivalManage` / `route` 三態轉換表 |
| 拿掉 refresh 後他機改門檻本地過舊 | realtime group 更新仍會 sync props；可接受短暫樂觀分歧 |

## 10. 已確認決策摘要

| 決策 | 選擇 |
|------|------|
| 架構 | 方案 A：隊長本機判 + 經 RPC → notify_push → APN |
| 參考點 | 隊長 GPS，1 對多 |
| 隊員 | 只收通知，不算距離 |
| Toggle | 樂觀 UI + 背景寫群組設定 |
| 抵達管理入口 | 路線內 → 獨立頁 |
| Peek 單人 | 不顯示「成員」；按鈕靠右 + 垂直置中 |
