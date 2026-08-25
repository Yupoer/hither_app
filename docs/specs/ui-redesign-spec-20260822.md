# Hither UI 重構與設計規格說明書 (Agent 實作專用)

文件編號：`SPEC-20260822-UI-REDESIGN`  
最後更新：2026-08-22（toggle／頭像 Target 覆寫）  
負責角色：Sol（架構審查與門禁）/ Luna（TDD 實作與契約測試）  
參考原型：`hither/.lavish/hither-target-ux/index.html`（可互動模擬器）  
單檔離線版：`hither/.lavish/hither-target-ux/hither-target-ux-portable.html`  
決策記憶檔：`hither/.lavish/hither-target-ux/MEMORY.md`  
覆寫：GitHub #220／#225／#229 的開關與分頁契約。**#225「不引入新 toggle 元件」作廢。**  

---

## 1. 全域視覺規範與 Design Tokens 映射

所有重構元件必須嚴格遵循 `src/theme.ts` 與 `src/glass.ts` 之 Token，嚴禁寫死魔術數字（Magic Numbers）。

### 1.1 間距與圓角常數 (Theme Constants)
```ts
// 引用來源：hither_app/apps/mobile/src/theme.ts
spacing = {
  xs: 4,   // 緊湊內部間隙 (icon 與文字)
  sm: 8,   // 網格間距、工具列按鈕間隙
  md: 12,  // 卡片內距、Header 邊界
  lg: 16,  // 螢幕標準邊距、區塊邊距
  xl: 24,  // 大區塊垂直分隔
}

radius = {
  sm: 8,   // 按鈕、小標籤、商品卡片
  md: 12,  // 次級卡片、Segmented 底槽
  lg: 20,  // 大卡片、分組 Inset 容器
  pill: 999 // 膠囊按鈕、圓形前進/刪除按鈕
}
```

### 1.2 系統控制項與圖示規範

#### 詞彙（必須遵守，禁止混用）

| 詞 | 意思 | 可否當完成 |
| --- | --- | --- |
| **iOS native Toggle** | 系統實際畫的開關：SwiftUI `Toggle`（經 `@expo/ui`）或 UIKit `UISwitch`，長得像 Settings.app 那顆 | 可以 |
| **iOS-style / 系統風格** | 自繪仿造（Design System `Switch.jsx`、CSS 彈簧） | **不可以** |
| **RN `Switch` / 現況 `NativeSwitch`** | React Native wrapper | **不是本包 iOS Target** |
| **群組頭像** | 這個團自己的大頭貼（像 LINE 群組頭像），存在 `groups.avatar` | 可以 |
| **成員頭像** | 你這個人的頭像，存在 `profiles.avatar`，跨團相同 | 可以 |

已確認（2026-08-22）：**只換開關**、**跟新 spec 改測試**、**群組頭像**。禁止再把整列改成系統 List。

上一輪失敗模式：驗收只查原始碼有沒有 `<NativeSwitch>`，Jest 綠了就關票。本包禁止重演——測試必須跟著新 spec 改掉。

#### 1.2.1 只換開關：右邊那顆是系統 Toggle，列維持現有玻璃列

**使用者看到的：** 設定、通知偏好、地圖與旅程、成員「精準定位」等「開／關」列，**左邊文字與列背景維持現有玻璃列**；**右邊那顆必須是 iOS 系統 Toggle**（Settings.app 那顆的樣子）。開啟色為系統綠 `#30D158`，**不塗 Hither 橘色／accent**。參考 `switch-on.jpg`、`switch-off.jpg`。

**本包不做：** 把整列改成系統 grouped list（`List` + `ListItem`）。那是下一包的事。

**禁止當完成：**

* 繼續用 RN `NativeSwitch` 當 iOS 開關。
* Design System `Switch.jsx`（HTML 彈簧、accent glow）。
* 「不引入新 toggle 元件」（#225）。本包**必須**引入 `@expo/ui` 系統 Toggle。
* 舊測試過關但實機開關仍是 RN `Switch`：`expect(src).toContain('<NativeSwitch')`、`expect(tabs).toContain('SheetPaneTabs')`。這些測試**必須改寫**，不得當門檻留下。

**實作方向（鎖定）：**

1. 專案已是 Expo SDK 56。本包安裝 `@expo/ui`。SDK 56 可在 Expo Go 跑，禁止用「要 Dev Client」擋下來。
2. iOS Target：`@expo/ui` universal `Switch`（底層 SwiftUI Toggle），包在 `Host` 內，放進現有玻璃列右側。
3. 單一 wrapper（建議名 `SystemToggle`）對外只暴露 `value` / `onValueChange` / `accessibilityLabel`。畫面層不得 `import { Switch } from 'react-native'`，也不得再走 `NativeSwitch`。
4. 平台分支只准存在這個 wrapper。畫面層禁止 `Platform.OS`。
5. Android：同一 `@expo/ui` `Switch`（Compose），可用 accent track；iOS 不行。
6. iOS 若仍吃 tint／accent：關掉，維持系統綠。必要時才降到 `@expo/ui/swift-ui` Toggle（平台檔隔離）。
7. 失敗退路：真機對不齊 Settings.app 那顆時，薄 native module 包 `UISwitch`。退路寫進 PR，不得默默退回 `NativeSwitch`。
8. 玻璃列為了對齊系統 Toggle 的微調（含少量 `translateY`）允許。不准為了對齊再畫一條自繪軌道。

**測試（舊契約必須改，不是留著打架）：**

* 改寫 `nativeSwitchContract.test.ts`、`mapStatusSettingsPaywall.test.ts`、`storeUiContracts.test.ts`、`mapStoreUxContracts.test.ts`、`mapUiContracts.test.ts`、`acceptance-map.json` 裡要求 `NativeSwitch`／`SheetPaneTabs` 字串的條目。
* 新斷言：開關 render 出來是 `@expo/ui` Switch（或退路 native `UISwitch`），**不是** RN `Switch`；iOS 樹沒有 `trackColor`／`thumbColor`／`ios_backgroundColor`。
* 四分頁斷言：是原生 Segmented Control／`@expo/ui` Picker，**不是** `SheetPaneTabs`。
* 行為：切換仍寫入既有 state owner（`highAccuracy`、通知偏好、地圖與旅程等）。
* Visual DoD：iOS 實機對照 Settings.app 那顆開關與參考圖。Jest 綠 ≠ 完成。

#### 1.2.2 成員／路線／工具／商店 = 原生 Segmented Control（不是 Toggle）

四分頁是**分段控制**，禁止做成 Switch／Toggle。

* Target：iOS 原生 `UISegmentedControl`，或 `@expo/ui` `Picker` segmented。視覺對齊 Image #1 玻璃膠囊。
* **自繪與原生衝突時，原生勝出。** `SheetPaneTabs` 自繪 icon tabs **不得**當完成。
* 測試不得再用「檔案含 `SheetPaneTabs`、不含 `NativeSwitch`」當過關。

#### 1.2.3 圖示與觸控

* **零 Emoji 規範**：工具列、按鈕、停靠點行內嚴禁 Emoji，一律 `@expo/vector-icons`（Ionicons）。**頭像 Emoji 目錄是例外**（見 §6），不得借這條把隊伍／成員頭像改成字母。
* **觸控熱區**：獨立按鈕與拖曳把手最小 **44×44px**（可 `hitSlop={8}`）。系統 Toggle 沿用系統尺寸（約 51×31），不要為了 44px 外面包一層自繪軌道。

---

## 2. 模組一：設定 Bottom Sheet 與子 Sheet 交互分流

### 2.1 檔案清單
* 目標修改：`hither_app/apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx`（重構為 Bottom Sheet）
* 目標新增/抽離：`hither_app/apps/mobile/src/screens/MapScreen/components/SettingsChildSheet.tsx`（獨立半開/全開子 Sheet）
* 契約測試：`hither_app/apps/mobile/src/__tests__/mapStatusSettingsPaywall.test.ts`

### 2.2 Sheet 展開手勢與層級規範
1. **設定根 Sheet**：
   * 點擊地圖齒輪開啟，**預設為 Stage 1（半開）**，左右保留 `10px` 安全邊距（`left: 10, right: 10`），頂部圓角 `36px`。
   * **手勢連動**：在 Stage 1 狀態下，若使用者向下滑動內容或向上拖曳 Grabber，**強制平滑展開為 Stage 2（全開，貼齊螢幕邊緣 `left: 0, right: 0`）**。
   * 在 Stage 2 狀態下向下拖曳 Grabber 則退回 Stage 1；在 Stage 1 向下拖曳則 Dismiss 關閉。
2. **設定子 Sheet（配置類）**：
   * 包含項目：`語言`、`主題背景`、`文字大小`、`通知設定`、`地圖與旅程`、`意見回饋`、`診斷`、`重設旅行偏好`。
   * 點擊任一項目時，在設定之上疊加一層子 Scrim（`rgba(4,7,12,0.35)`），並升起獨立的子 Bottom Sheet。
   * **預設為半開（52% 高度，左右留 10px 邊距）**。
   * 用戶可手動向上滾動／拖曳展開為全開（100% 高度，貼齊螢幕邊緣），或點擊右上角叉叉 `✕`（或向下滑動）關閉返回設定主頁。
   * **禁止在同一個 Sheet 內使用 Stack Navigation Push**。
3. **直接動作類（不開任何 Sheet）**：
   * `回到主畫面`：關閉設定 Sheet 並直接執行主畫面路由導向。
   * `離開群組` 與 `登出`：**不開任何 Bottom Sheet**，直接調用系統原生 `Alert.alert()` 確認框，確認後執行對應 Redux/State 清理。
4. **訂閱入口**：
   * 點擊頂部 `升級 Premium 橫幅` 或 `訂閱` 列，直接觸發全螢幕 `PaywallSheet`。

---

## 3. 模組二：商店分頁重構 (Store Pane)

### 3.1 檔案清單
* 目標修改：`hither_app/apps/mobile/src/screens/MapScreen/components/StorePane.tsx`
* 契約測試：`hither_app/apps/mobile/src/__tests__/storeUiContracts.test.ts`

### 3.2 佈局與元件細節
1. **頂部大看板橫幅（僅未訂閱者可見）**：
   * 容器樣式：`background: linear-gradient(135deg, #183c66 0%, #296096 100%)`，`borderWidth: 1`，`borderColor: 'rgba(55,182,255,0.3)'`，`borderRadius: 18`，`padding: 14`。
   * 左側標籤：`PREMIUM` 膠囊標籤（背景 `#37B6FF`，字體 `10px bold`，顏色 `#071526`）。
   * 標題與簡述：標題 `15px bold #FFFFFF`；副標題 `11.5px rgba(255,255,255,0.8)`。
   * 右側圖示：圓形毛玻璃按鈕（`width: 34, height: 34, borderRadius: 17`），內嵌加粗白色箭頭 `→`。
   * 點擊行為：直接開啟全螢幕 `PaywallSheet`。
2. **代幣餘額與廣告領取列**：
   * 容器樣式：單行水平佈局（`flexDirection: 'row'`, `justifyContent: 'space-between'`, `alignItems: 'center'`），背景 `rgba(255,255,255,0.05)`，圓角 `12px`，內距 `8px 12px`。
   * 左側餘額：星號向量圖示 + 數量（字體 `13px bold`，顏色 `#FFD60A`）。
   * 右側按鈕：`▶ 看廣告領取 +10` 膠囊按鈕（背景 `rgba(255,214,10,0.16)`，顏色 `#FFD60A`，字體 `11px bold`）。
3. **精選商品雙欄網格 (2-Column Grid)**：
   * 容器樣式：`flexDirection: 'row'`, `flexWrap: 'wrap'`, `gap: 8`。
   * 商品卡片寬度：`calc(50% - 4px)`（雙欄等寬）。
   * 卡片內部架構：
     * 頂部 Header：左側放置向量圖示框（`28×28px`，背景 `rgba(255,255,255,0.08)`，圖示藍色），右側放置分類標籤（如 `外觀`、`權限`、`道具`，字體 `9.5px bold`）。
     * 品名：`13px bold #FFFFFF`，最多 1 行，超過截斷。
     * 簡要描述：`10.5px rgba(235,235,245,0.48)`，行高 `1.3`，固定 2 行高度。
     * 底部兌換鈕：全寬膠囊按鈕（高度 `28px`，字體 `11px bold`，背景 `rgba(255,255,255,0.1)`；Premium 專屬品項背景改為 `colors.accent`）。
4. **分頁控制項 (Segmented Control)**：
   * 見 §1.2.2：iOS 原生 Segmented Control（`UISegmentedControl` / `@expo/ui` Picker segmented），四段為成員／路線／工具／商店。
   * 視覺對齊 Image #1。自繪 `SheetPaneTabs` 與原生衝突時原生勝出。禁止用 Switch 充當分頁。

---

## 4. 模組三：路線編輯順序 (DestinationReorderList)

### 4.1 檔案清單
* 目標修改：`hither_app/apps/mobile/src/components/DestinationReorderList.tsx`
* 契約測試：`hither_app/apps/mobile/src/__tests__/destinationDatePickerContract.test.ts`、`routeEditorKmlContract.test.ts`

### 4.2 比例修復與細節規格
1. **移除 1.3 倍失真比例**：
   * 刪除 `const REORDER_VISUAL_SCALE = 1.3;`，全面回歸標準 `1.0` 尺度。
   * 行高標準化：`ROW_HEIGHT = 52`（或 54px），標題字體固定為 `15px fontWeight: '600'`，消除過大膨脹。
2. **左上角 3 態循環切換契約 (3-State Interaction Mode)**：
   * 狀態循環：`drag (≡)` ➔ `select (☑)` ➔ `none (🔒)` ➔ `drag`。
   * 狀態視覺表現：
     * `drag` 模式：停靠點右側顯示 `≡` 拖曳把手（`width: 44, height: 44` 點擊熱區）。
     * `select` 模式：停靠點右側顯示直徑 `22px` 勾選圓圈；當 `selectedIds.length > 0` 時，左上角模式按鈕切換為紅色的 `刪除 (N)`（`color: '#FF453A', fontWeight: '800'`）。
     * `none` 模式：停靠點右側顯示微暗的鎖定圖示 `🔒`，禁用所有拖曳與選取。
3. **頂部單行緊湊工具列 (Single-Line Action Toolbar)**：
   * 容器樣式：`display: 'flex'`, `flexDirection: 'row'`, `padding: '8px 12px'`, `gap: 6`。
   * 3 顆按鈕等比收整（寬度比約 `1.2 : 1.1 : 0.9`），最小高度 `36px`，圓角 `9px`，背景 `rgba(255,255,255,0.06)`，邊框 `rgba(255,255,255,0.1)`。
   * 按鈕內容（**全向量圖示，零 Emoji**）：
     * `[ <calendar-svg> 天數與日期 ]`
     * `[ <star-svg> 常用地點 ]`
     * `[ <upload-svg> 匯入 ]`
   * **保證在 iPhone SE 至 Pro Max 全尺寸螢幕 100% 維持單行不換行**。
4. **天數列與「設定住宿」按鈕靠左對齊**：
   * 天數 Header：`flexDirection: 'row'`, `alignItems: 'center'`, `gap: 10`。
   * 左端為 `● 第 1 天`（顏色圓點直徑 `9px` + 字體 `15px bold`）。
   * 右側緊鄰 **靠左對齊** 的 `[ <bed-svg> 設定住宿 ]` 向量按鈕（`borderWidth: 1, borderColor: 'rgba(255,107,53,0.55)', padding: '5px 10px', minHeight: 28, borderRadius: 7`）。
   * 收合箭頭 `▲` 靠最右側對齊（`marginLeft: 'auto'`）。
5. **停靠點格數內容 (Name Only)**：
   * 格內**僅顯示停靠點名稱**（`15px fontWeight: '600' #FFFFFF`，單行截斷），去除所有地址、抵達時間副標題與裝飾 Emoji。
   * 左側停靠點圓形 Pin：直徑 `26px`，內嵌向量定位圖示（住宿卡片則內嵌向量床位圖示）。

---

## 5. 模組四：全螢幕訂閱頁面 (Paywall)

### 5.1 檔案清單
* 目標修改：`hither_app/apps/mobile/src/components/PaywallSheet.tsx`、`PremiumPresentation.tsx`

### 5.2 排版與換行修正
1. **文字邊距與斷詞修復**：
   * 標題與賣點副標題水平內距設為 `20px`，字體 `25px bold`，行高 `1.25`，確保繁體中文標題不出現單字突兀換行。
2. **方案卡片排版與價格資料源**：
   * **價格維持 StoreKit / RevenueCat 現有動態載入設定**，嚴禁寫死靜態金額。
   * 年訂閱卡片：左側選中 Radio 圓圈、方案標題 `年訂閱方案`、`省 64%` 標籤（背景 `#256bb0`）、每月折算副標題；右側放置總價與 `每年續訂` 說明。
   * 月訂閱卡片：月繳方案名稱與即時價格對齊。
3. **CTA 與 Legal 佈局**：
   * 漸層全寬 CTA 按鈕（高度 `48px`，圓角 `999px`，字體 `15.5px bold`）。
   * 底部橫向排列 `隱私權政策 · 服務條款` 與 `恢復購買` 按鈕。

---

## 6. 模組五：成員頭像統一與群組頭像

### 6.1 問題（現況證據）

兩件事被混在同一個體感裡，必須一起修，但 source of truth 分開：

1. **同一個人，兩個畫面不一樣。**
   * 隊伍列表 `MyTeams`：`getMyJoinedGroups` 用 `profile.avatar || avatarForUser(userId)`，一定有 Emoji。
   * 進隊伍後：`SessionContext` hydrate 是 `row.avatar ?? undefined`；`mapMember` 不套 `avatarForUser`；`FlockRow`／地圖 sheet 頭像／peek／邀請列在 `avatar` 空時畫 `name.slice(0, 1)` 字母或數字。
   * 所以列表看得到羊／狼，進隊伍變成 `A`／`3`。
2. **團沒有自己的大頭貼（群組頭像）。**
   * `groups` 沒有 `avatar`／`avatar_color`。MyTeams 卡片只堆成員頭像。每個團不能有自己的圖。

### 6.2 兩個身份，禁止混用

| 身份 | 白話 | Source of truth | 誰能改 | 出現位置 |
| --- | --- | --- | --- | --- |
| **成員頭像** | 你這個人的臉 | `profiles.avatar` + `avatar_color`（跨團相同） | 你自己 | 列表裡的人、進團後的自己與隊友、地圖標記、peek、邀請列 |
| **群組頭像** | 這個團的大頭貼（像 LINE 群組頭像） | `groups.avatar` + `avatar_color`（每團一組，互不繼承） | Leader；建團時必選或給預設 | MyTeams 卡片主圖、地圖 group pill、設定裡的團資訊 |

你的頭像**不會**因加入不同團而改變。每個團另有自己的群組頭像。不是「你在 A 團羊、B 團狼」。

### 6.3 成員頭像：單一 resolver

新增一個純函式（建議名 `displayMemberAvatar`），所有畫面走同一條，禁止各畫面自己 fallback：

```
stored emoji ∈ AVATAR_EMOJI → 用它
否則 → avatarForUser(userId)
顏色：stored avatar_color → 否則 memberColor(userId)
```

套用點（同一結果）：

* `getMyJoinedGroups` 成員堆疊（可刪掉只在這裡的 `avatarForUser` 特製路徑）
* `SessionContext` hydrate／`useAuthFlow` 寫入
* `mapMember`／group snapshot
* Map sheet 自己的頭像按鈕、`FlockRow`、peek 堆疊、group pill 成員圈、`GroupMap` 標記、邀請隊友列

**字母／數字 initials 只准用於沒有 `userId` 的佔位格**（例如 MyTeams 人數大於已載入 profile 的空槽）。已知 `userId` 的列**禁止** initials。

個人資料仍用既有 `AVATAR_EMOJI` × `AVATAR_COLORS` picker。改自己的頭像後，列表與進隊伍必須同一顆，不需重啟。

### 6.4 群組頭像：每團一張，互不繼承

* Schema：`groups.avatar text`、`groups.avatar_color text`（對齊 profiles；RLS 維持 Leader 可 update）。
* Domain：`Group.avatar`、`Group.avatarColor`。`mapGroup`／create／join／lite fetch 都要帶。
* 預設：建團時若 Leader 沒選，用 `avatarForGroup(groupId)`（與 `avatarForUser` 同一目錄、以 group id 穩定雜湊）。**禁止**拿 Leader 個人頭像當群組頭像。
* Leader 可在建團與進團後的團設定改群組頭像。改 A 團不影響 B 團，也不改任何人的成員頭像。
* MyTeams 卡片：**主圖是群組頭像**（大圓）。成員堆疊改為次要。展開列先顯示群組頭像，再顯示成員。
* 進團：group pill／sheet 團名旁顯示**群組頭像**；成員列繼續顯示各成員頭像。兩者同時在場，不得互相覆蓋。

### 6.5 非目標

* 不上傳照片／URL 頭像（維持 Emoji 目錄）。
* 不做「同一個使用者在每隊長得不一樣」的 membership-scoped 頭像。
* 不把 Live Activity 動態島當本包必驗（既有 native 限制照舊）；能順手把隊伍／成員 Emoji 傳進 payload 就傳，沒有不擋收工。

### 6.6 測試

* `displayMemberAvatar`／`avatarForGroup`：有 stored、無 stored、空字串、未知 userId 佔位。
* `mapMember`、session hydrate、`getMyJoinedGroups` 對同一 user 產出同一 emoji／色。
* `FlockRow`／header：有 `userId` 時不走 `name.slice(0, 1)`。
* `mapGroup` 含群組頭像；Leader 更新後 MyTeams 與 Map 讀到新值；其他 group 不變。
* 禁止再用「檔案裡有沒有 `avatarForUser` 字串」當唯一過關。

---

## 7. 驗收標準與測試契約 (Definition of Done)

1. **視覺驗收 (Visual DoD)** — 實機，不是 Jest 字串：
   * iOS 開／關列：**右邊那顆**對齊 Settings.app Toggle 與 `switch-on.jpg`／`switch-off.jpg`。列本身維持玻璃列。自繪開關軌道、品牌色 thumb 不算過。
   * 成員／路線／工具／商店是原生 Segmented Control，不是自繪 icon tabs，也不是 Switch。
   * 路線順序頁在所有解析度下頂部 3 個按鈕 100% 不折行；工具列／停靠點無殘留 Emoji（頭像 Emoji 除外）。
   * 點擊設定「回到主畫面 / 離開群組 / 登出」絕不彈出 Bottom Sheet。
   * 設定子 Sheet 支援半開預設、向上展開全開與右上角 `✕` 關閉。
   * 團列表與進團後，**同一 userId 顯示同一顆成員頭像**；每個團有自己的**群組頭像**，列表主圖與進團團名旁一致。
2. **自動化測試驗收 (Test DoD)**：
   * 舊契約（`NativeSwitch`／`SheetPaneTabs` 字串）**改寫後** `npm run test` 全數通過。新斷言看控制項 type 與 resolver 行為，不搜原始碼字串當唯一過關。
   * PR changed functions coverage ≥85%；每個本包 acceptance 能對到具名測試。
   * 無 TypeScript 類型錯誤與 Lint 警告。
3. **明確不算完成**：
   * iOS 開／關仍是 `NativeSwitch`。
   * 舊測試沒改、跟新 spec 打架卻拿 CI 綠關票。
   * 只讓 CI 綠、沒有 iOS 實機對照 Toggle。
   * 只修 MyTeams 或只修 FlockRow，兩邊頭像仍不一致。
   * 用 Leader 個人頭像冒充群組頭像。
   * 把整列改成系統 List（本包明確不做）。
