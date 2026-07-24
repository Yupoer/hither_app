# Android／全 App 互動黑屏與卡住防護 Implementation Plan

> 日期：2026-07-24
>
> 目的：把「Pixel 上由更多按鈕回到主畫面，再進入地圖後黑屏」整理成可驗證的修復計畫，並把防護邊界擴大到所有按鈕、Alert、ActionSheet、overlay 與導航操作。

## 1. 目標與限制

### 目標

1. 修復並驗證 `地圖 → 更多 → 回到主畫面 → 建立／加入 → 地圖` 的重入流程。
2. 所有使用者觸發的互動都必須符合同一組安全規則：不重複執行、不無限 loading、錯誤可見、畫面可恢復、失敗可追蹤。
3. 將 JS render error、按鈕 handler error、非同步逾時、導航堆疊錯誤、Map native surface 異常、Android process crash／ANR 分開量測，避免用「顯示黑色 fallback」掩蓋真正的 native 問題。

### 不承諾的事項

- JS `try/catch` 無法攔截 native process crash、GPU driver crash 或 ANR；這些必須透過 `logcat`、`ApplicationExitInfo`、`dumpsys gfxinfo` 與實機重跑確認。
- 不新增 crash SDK、狀態管理套件或另一套導航框架；優先沿用現有 `AppErrorBoundary`、`activityLog`、performance outbox、React Navigation 與 native map adapter。
- 不用定時 remount `MapView`、全域吞掉例外或永久顯示 spinner 來假裝修好。

## 2. 目前程式證據

| 邊界 | 目前行為 | 風險 |
|---|---|---|
| `MapScreen.goHomeCreateOrJoin` | 呼叫 `navigation.navigate('RoleSelect')`，保留目前 `Map` route | 反覆回首頁再進群組可能累積多個 `Map` route；這是目前最優先驗證的導航堆疊假設 |
| `AuthScreen`／`MyTeamsScreen` | 以 `navigation.replace('Map', ...)` 進入地圖 | 新舊 `Map` route 是否混在 stack 中，取決於前一段導航是否 reset |
| `GroupMap` | Android 使用 `PROVIDER_GOOGLE`、`showsUserLocation`、`onMapReady`／`onMapLoaded`；Map key 目前跟隨 theme | 舊的 native surface、renderer 或 callback 若未正確釋放，重入後可能只剩黑色地圖層 |
| `useDeviceLocation`／`useGroupState` | 以 `AppState` 控制 watcher、Realtime channel 與 resume refresh | 多個 Map instance 或 cleanup 不完整時，可能造成重複 watcher、重複 channel、render churn 或卡住 |
| `AppErrorBoundary` | 能處理 React render error，顯示 Retry；不處理 event handler 的例外 | 按鈕 callback 的同步 throw 不會自動進 React Error Boundary |
| `activityLog`／`ErrorUtils` | 已記錄 global JS exception 與 performance error，並保留原本 handler | 可追蹤，但目前不能讓操作本身恢復，也不能攔 native crash |
| UI controls | `Pressable`、`TouchableOpacity`、Alert actions、ActionSheet callbacks 分散在多個 screen／component | 沒有單一的 double-tap、timeout、finally、失敗提示契約 |

已存在且應保留的地圖低風險修復：Android 不綁最後會丟棄的 MapView location callback；`MapScreen` 只把第一個可用座標作為 `initialCenter`；Map lifecycle 已有 `onMapReady`／`onMapLoaded` 記錄。新的修復不可倒退這三項行為。

## 3. 事件流程與第一個根因假設

```text
MapScreen
  └─ 更多／Settings
      └─ 回到建立／加入主畫面
          └─ RoleSelect
              └─ Auth 或 MyTeams
                  └─ replace Map
                      └─ MapScreen → GroupMap → Google Maps surface
```

第一優先假設是 `MapScreen → navigation.navigate('RoleSelect')` 沒有清掉舊 `Map` route，導致回到群組時出現重複 Map instance 或舊 native surface。這是「程式碼已可見的風險」，不是尚未有 logcat 證據的定論；修復前仍須取得 route state、Map mount count、ready／loaded、crash buffer 與畫面錄影。

第二層假設是按鈕 action 在切換 overlay、導航、資料 fetch 與 Map surface 同一個 frame 內交錯，造成 JS render error 或 native surface lifecycle race。第三層才是 Google Maps renderer、API key／SHA restriction、Play Services 或 GPU driver；沒有裝置證據前不先切換 `LEGACY` renderer 或關閉 New Architecture。

## 4. 實作階段

### Task 0：建立可重現基線與互動入口清單

**讀取／修改：**

- `apps/mobile/src/screens/MapScreen.tsx`
- `apps/mobile/src/components/GroupMap.tsx`
- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/screens/RoleSelectScreen.tsx`
- `apps/mobile/src/screens/AuthScreen.tsx`
- `apps/mobile/src/screens/MyTeamsScreen.tsx`
- `apps/mobile/src/components/AppErrorBoundary.tsx`
- `apps/mobile/src/utils/activityLog.ts`

**步驟：**

- 列出所有 `Pressable`、`Touchable*`、`Alert.alert` actions、`ActionSheetIOS` callbacks、overlay close／submit、Map imperative actions 與 navigation calls。
- 每個入口標上 `screen`、`actionId`、sync／async、是否會改 route、是否會改 native surface、目前 busy／disabled／error handling。
- 以受影響 Pixel 建立至少一組原始流程與一組目前流程：目前 Android 更多選單的「回首頁」若只放在 Settings，使用「更多 → 設定 → 回首頁」完成等價重入。
- 每次保留 route state、`map_mount`／`map_ready`／`map_loaded`、`logcat -b crash`、`exit-info` 與錄影。

**完成條件：** 能分辨「黑的是 Map surface」、「整個 React tree」、「整個 Activity」或「只是 overlay／loading 卡住」。

### Task 1：以 reset 修復回首頁導航交易

**主要檔案：**

- `apps/mobile/src/screens/MapScreen.tsx`
- `apps/mobile/src/__tests__/navigationInteractionContract.test.ts`

**做法：**

- 將「回到建立／加入主畫面」視為工作流程邊界，不使用 `navigate('RoleSelect')` 疊加新 route；改成一次性的 `navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] })`，保留 session／membership，不強制 leave group。
- 在 reset 前先關閉 overlay／sheet 的本地狀態；reset 後不得再由舊 Map instance 執行 callback。
- 對連點做 single-flight guard；同一個 `actionId` 在 navigation state 尚未穩定前不得再次 reset。
- `RoleSelect → Auth → replace Map` 與 `RoleSelect → MyTeams → replace Map` 維持既有流程，確保新的 Map 是唯一當前 Map route。

**先寫的契約測試：**

- `goHomeCreateOrJoin` 使用 `reset`，不使用保留舊 Map 的 `navigate`。
- reset 後 route state 只有一個 `RoleSelect` 起點；重進群組後只有一個 `Map`。
- membership、session 與使用者資料不因回首頁被清除。

### Task 2：建立全 App 共用的安全 action 邊界

**新增前先確認沒有等價實作；預計檔案：**

- `apps/mobile/src/utils/uiAction.ts`
- `apps/mobile/src/components/SafePressable.tsx`
- `apps/mobile/src/__tests__/uiActionContract.test.ts`

**契約：**

```ts
runUiAction(actionId, task, {
  screen,
  timeoutMs,
  onBusyChange,
  onError,
});
```

- sync throw 與 rejected Promise 都記錄 `ui_action_error`，不得成為未處理 Promise。
- 同一 action 在執行中忽略後續點擊；以 `finally` 清除 busy，包含 timeout、unmount 與 navigation 成功／失敗。
- 預設 timeout 15 秒；讀取、搜尋、導航、登入等 action 可明確指定不同上限，但不得無限等待。
- timeout 只結束 UI 等待狀態，不假裝取消底層請求；可取消的網路／定位工作使用既有 abort／取消介面，無法取消時以 request token 忽略晚到結果。
- 失敗留在原畫面，顯示可操作的錯誤提示或 retry，不把 screen state 清成空白。
- action payload 只含 `actionId`、screen、route、duration、appState、結果分類；不得送使用者資料、token、座標或完整 stack。

`SafePressable` 只負責統一 press 行為與 busy／accessibility state；Alert、ActionSheet、navigation listener、gesture submit 等非 `Pressable` 入口直接呼叫 `runUiAction`，不再另造第二套 wrapper。

### Task 3：分批遷移所有互動入口

遷移順序固定為：

1. 導航與 session：回首頁、建立／加入、切隊伍、登出、leave group。
2. Map／sheet：更多、設定、overlay close、搜尋、目的地新增／刪除／重排、recenter、route action。
3. 網路與帳務：登入、升級、兌換、feedback、診斷上傳。
4. 純 UI：tab、segmented、dismiss、cancel、backdrop、重試。

每批完成後執行既有單元測試與一輪實機 smoke，不一次重寫整個 UI tree。對只做 state setter 的同步按鈕可使用最小 wrapper；對非同步 action 必須完整套用 timeout、single-flight 與 `finally`。

### Task 4：建立可恢復的畫面 fallback

**修改：**

- `apps/mobile/src/components/AppErrorBoundary.tsx`
- `apps/mobile/App.tsx`
- 必要時新增 `apps/mobile/src/components/InteractionRecoveryBanner.tsx`
- `apps/mobile/src/components/GroupMap.tsx`

**規則：**

- Root Error Boundary 保留 Retry，並補上事件分類、目前 screen、route、launch phase；retry 以受控 remount 重建 React tree，不無限重試。
- `GroupMap` 外包一層 local boundary；只在 Map React subtree 壞掉時顯示 Map fallback，sheet／retry／回首頁仍可操作。
- Map fallback 提供一次性的「重新載入地圖」與「回到主畫面」；不得依 timer 自動 remount。
- `onMapReady`、`onMapLoaded`、unmount、surface failure 各自最多記錄一次；`ready` 後長時間沒有 `loaded` 記為診斷事件，不直接宣告 crash。
- 所有 action error／timeout 使用同一個 root-level recovery banner 或現有錯誤提示，不在每個 component 建一個新的 toast／Alert 佈局。

### Task 5：驗證 native map、lifecycle 與 process failure

**工具：** release-like Android build、ADB、`logcat -b all`、`logcat -b crash`、`dumpsys gfxinfo`、`dumpsys activity exit-info`、必要時 Perfetto。

- 先驗證 Task 1／2／3 後的流程；若黑屏消失，不再做 renderer workaround。
- 若仍是 Map 黑而 UI 正常，再比較 Map surface reset、provider／API key／Play Services 與 renderer；每次 A/B 只改一個變因。
- 若整個 Activity 消失或有 fatal signal，轉 native crash／ANR 路徑；不得只加 JS fallback。
- 若只有 loading 不結束，檢查 action timeout、`useGroupState`、`useDeviceLocation`、Realtime channel 與 cleanup；不要把網路慢誤判成 renderer crash。

### Task 6：全 App 驗收與回歸門檻

**核心流程：**

- Pixel：登入／guest、建立、加入、更多、設定、回首頁、再次建立／加入、回地圖。
- 每個 screen 的主要按鈕、取消、返回、submit、retry、overlay backdrop、Alert action 至少各 10 次。
- foreground／background 10 次、theme 不變與 theme 切換各一輪、網路離線／恢復各一輪。

**門檻：**

| 指標 | 目標 |
|---|---:|
| 回首頁再進地圖後黑 Map／黑整個 App | 0/10 |
| 互動後整個 React tree 灰屏或無可操作 fallback | 0/10 |
| 主要 action 重複提交 | 0 次 |
| action timeout 後永久 loading | 0/10 |
| route stack 同時存在多個當前 Map | 0 次 |
| JS render error | 有錯誤事件、有 retry；不丟失整個 fallback |
| native crash／ANR | 0/10；以 crash buffer／exit-info 證明 |
| frozen frame >700 ms | 0 次；若發生需保留 gfx／Perfetto 證據 |

## 5. 驗證指令

```powershell
cd apps/mobile
npx jest --runInBand src/__tests__/navigationInteractionContract.test.ts src/__tests__/uiActionContract.test.ts src/__tests__/androidMapContract.test.ts src/__tests__/performanceRegression.test.ts
npx tsc --noEmit
```

實機每次 run 必須保存：

```powershell
adb logcat -c
adb shell dumpsys gfxinfo app.hither.mobile reset
adb shell am force-stop app.hither.mobile
# 完成一輪互動後
adb logcat -b all -v threadtime -d > .qa-runtime/android-interaction-2026-07-24/logcat-all.txt
adb logcat -b crash -v threadtime -d > .qa-runtime/android-interaction-2026-07-24/logcat-crash.txt
adb shell dumpsys gfxinfo app.hither.mobile > .qa-runtime/android-interaction-2026-07-24/gfxinfo.txt
adb shell dumpsys activity exit-info app.hither.mobile > .qa-runtime/android-interaction-2026-07-24/exit-info.txt
```

## 6. Definition of Done

- 回首頁使用 reset，不保留舊 Map route；重進地圖只有一個 Map instance。
- 所有互動入口完成 inventory，主要入口通過共用 action boundary；沒有裸露的 `void asyncAction()`。
- 同步 throw、Promise reject、timeout、navigation failure 都有可見 recovery 與 sanitized telemetry。
- React render error 有 root fallback；Map subtree error 不會遮住整個可恢復 UI。
- Android 實機 10 次流程沒有黑屏、灰屏、永久 loading、重複 Map route、crash 或 ANR。
- 未以猜測宣稱 Google renderer、Pixel 或其他裝置已修復；每項結論均附 logcat／exit-info／frame 證據。

## 7. 未來方向與風險

- 未來可把 `actionId + route + deviceModel + updateId` 做成聚合 dashboard，再決定是否需要 native crash SDK；目前先避免新增依賴。
- 主要風險是底層 Promise 不能取消、Google Maps renderer／GPU driver 差異，以及按鈕遷移遺漏；以 inventory、contract test 與 staged rollout 降低風險。
- 若 native crash／ANR 仍存在，下一步是 Android native lifecycle／renderer 專案，不是繼續增加 JS wrapper。
