# 地圖／設定介面微調與個人自訂快捷指令設計

## 目標

在不刪除既有功能、不移除現有 sheet、維持目前主要版面結構的前提下，改善 Hither 的間距、按鈕層級與繁體中文文案，並新增一個跟隨帳號的自訂快捷指令按鈕。

## 已確認的範圍

- 採用「分層工具列」方向：主動作、定位工具、成員清單各自保留目前區塊，只拉開指定物件的距離。
- 不重做地圖、BottomSheet、OverlaySheet 或 MyTeams 的導航結構。
- 不刪除歷史行程、KML 匯入、帳號、Hither Pro、高精準模式或既有快捷指令功能；歷史行程與 KML 只移動／增加入口。
- 所有新增或調整的按鈕維持至少 44px 觸控目標，沿用 Hither Design System 的 4px spacing grid、Liquid Glass、Signal Orange accent、圓角與深色地圖 chrome。
- 主要 UI 使用繁體中文；`settingaccount` 類型的標題統一使用「帳號」，並附簡短描述；帳號按鈕導向進一步資訊。

## 介面設計

### MyTeams

- 保留現有 header、返回、清除與隊伍卡片。
- 增加 header 與第一張隊伍卡片的垂直間距，以及隊伍卡片之間的節奏間距。
- 保留展開後成員欄與進入／離開按鈕，只調整展開區與上方成員欄的間距、按鈕高度、圓角、glass surface 和 pressed state。

### Map sheet

- 保留現有 `BottomSheet` 與 `sheetChildren` 順序。
- 在成員 heading 既有的 refresh action 區，將重整按鈕改為更清楚的 Liquid Glass icon button，與成員列表保留明確間隔。
- 將現有高精準模式控制移至重整按鈕附近，只有一份控制來源，仍由 `PreferencesContext` 的 `highAccuracy` 驅動；不新增第二份不同步的 toggle。
- 集合點區塊保留現有「編輯集合點順序」與既有 KML 入口，新增「歷史行程」同層入口。歷史 overlay 的內容與資料來源不變。
- `DestinationReorderList` 下方的「新增集合點」後新增第二個 KML 匯入入口；兩個入口都呼叫現有 `KmlImportSheet`，不複製匯入流程。

### Settings overlay

- 保留現有 `OverlaySheet`、語言、主題、通知、危險操作與帳號流程。
- 最上方依序放置「帳號」與「Hither Pro」兩個 glass row。
- 「帳號」顯示簡短描述，例如「管理登入方式、個人資料與帳號資訊」，點擊仍開啟既有 `AccountSheet`。
- 「Hither Pro」保留現有 active／upgrade 行為，只改善 row、間距與按鈕視覺。
- 歷史行程入口移到集合點區塊後，Settings 不再保留重複入口；歷史功能本身與 overlay 不刪除。

### Custom quick command

- 保留目前依 leader／follower 顯示的快捷指令格數。
- 使用每個角色指令列表的最後一格作為「自訂」按鈕，避免改變其他按鈕位置；leader 取代最後一格 `hurry_up`，follower 取代最後一格 `found_something`。
- 自訂設定包含：按鈕名稱與送出的通知內容；不增加 icon 選擇，避免擴大本次 UI 範圍。
- 尚未設定時，點擊自訂按鈕開啟既有設定 sheet／設定入口；已設定時直接送出通知。
- 設定變更採 optimistic UI，保存失敗時回復上一份資料並顯示既有錯誤提示模式。

## 個人化資料與通知資料流

### 持久化方案

使用 `profiles.preferences jsonb` 保存帳號級設定：

```json
{
  "quickCommand": {
    "label": "集合一下",
    "message": "請回到下一個集合點"
  }
}
```

不使用 AsyncStorage 作為唯一來源，因為它只跟裝置走；不把設定塞進 `profiles.onboarding`，避免混用資料語意。

Session hydration 由既有 `profiles.select('*')` 讀取 preferences，保存由既有 profile update 流程延伸。登出後重新登入不同帳號會取得該帳號的設定；匿名帳號升級為 email／Google 帳號沿用相同 auth uid，因此設定保留。

### Custom command type

新增 `custom` 至 `commands.type` 的資料庫 check constraint、TypeScript `CommandType`、push message label 與 i18n fallback。送出時仍沿用 `sendCommand(groupId, type, message)`，不新增第二套通知管線。自訂按鈕的 message 是帳號設定內容，group state 不保存它。

### 錯誤處理與邊界

- preferences 缺失、null 或格式不完整時使用空設定，快捷指令仍可正常顯示。
- label 與 message trim 後才保存；空 label 或空 message 不允許儲存。
- profile update 失敗時保留舊值並顯示錯誤；不阻塞地圖或成員資料。
- `custom` 通知若無 message 不送出，改開啟設定入口。
- KML 第二入口與第一入口共用同一個 sheet、Pro 限制、進度與錯誤處理。

## 受影響檔案

- `apps/mobile/src/screens/MyTeamsScreen.tsx`：只調整 spacing、button UI 與繁中 label。
- `apps/mobile/src/screens/MapScreen.tsx`：成員工具列、高精準 toggle、集合點／歷史／KML 入口與 reorder overlay 入口。
- `apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx`：帳號／Hither Pro 頂部層級與自訂快捷指令設定入口。
- `apps/mobile/src/components/QuickCommandsCard.tsx`：最後一格自訂按鈕與送出行為。
- `apps/mobile/src/components/AccountSheet.tsx`、`apps/mobile/src/i18n/index.ts`：帳號中文文案與自訂指令文案。
- `apps/mobile/src/types/index.ts`、`apps/mobile/src/state/SessionContext.tsx`、`apps/mobile/src/api/services/ProfileService.ts`：個人 preferences 與 custom type。
- `supabase/migrations/20260713000000_personal_quick_command.sql`：profiles preferences 欄位與 custom command constraint。
- 既有相關測試檔：preferences／profile mapping、custom command mapping、KML entry callback。

## 驗收條件

1. MyTeams header、第一張卡片、卡片間距與展開成員欄不再貼近；既有導航與按鈕功能正常。
2. Map sheet 仍存在；重整按鈕、成員欄與高精準 toggle 的視覺間距符合 4px grid 與 44px tap target。
3. 歷史行程可從集合點區塊開啟；編輯順序 overlay 的新增集合點下方可開啟第二個 KML 入口。
4. Settings 最上方是「帳號」與「Hither Pro」，帳號文案為繁體中文且按鈕仍開啟既有 AccountSheet。
5. 最後一格快捷指令顯示「自訂」；設定名稱與通知內容後，登出／重新登入同一帳號仍保留，換帳號不共用。
6. 自訂通知走既有 commands／push 流程，未設定時不會送出空通知。
7. `npm test` 與 `npm run typecheck` 通過。

## 未納入本次範圍

- 不重做 map、BottomSheet、OverlaySheet 或整個 Settings IA。
- 不加入自訂 icon、群組共用快捷指令、快捷指令排序、快捷指令歷史或新的通知服務。
- 不回復或整理工作區中與本需求無關的 design system 圖片變更。
