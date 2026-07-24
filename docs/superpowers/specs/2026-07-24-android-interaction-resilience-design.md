# Android／全 App 互動穩定性與黑屏恢復 Spec

> 日期：2026-07-24
>
> 狀態：提案，先完成證據收集與契約測試，再進行最小實作。

## 1. 問題定義

受影響流程是：在 Android Pixel 的地圖主畫面點擊更多，返回建立／加入主畫面，再次進入群組地圖後，可能看到黑屏、卡住或無法繼續操作。這個症狀不能只被定義成「地圖壞掉」，因為同一個使用者動作可能同時觸發：

- React state 與 overlay 關閉；
- React Navigation route transaction；
- MapView native surface detach／attach；
- location watcher、Realtime channel 與 resume refresh；
- 非同步建立／加入／資料載入；
- Android Activity、GPU renderer 或 process lifecycle。

本 spec 因此要求所有 button-like interaction 都具備一致的失敗邊界，而不是只修這一顆更多按鈕。

## 2. 名詞與失敗分類

| 名稱 | 定義 | JS fallback 是否有效 |
|---|---|---|
| Action error | `onPress` 同步 throw 或 async reject | 有；留在原畫面、顯示錯誤、記錄事件 |
| Action timeout | action 超過上限沒有完成 | 有限；結束 busy、允許 retry，底層請求以 token／abort 控制 |
| Navigation failure | 重複 navigate、route stack 污染、transition 後仍保留舊 screen | 有；single-flight、reset、route state contract |
| Render failure | React component render／commit 失敗 | 有；Error Boundary fallback |
| Map surface failure | MapView 黑、未 ready、ready 後未 loaded、surface 被錯誤重建 | 部分；local fallback／手動 reset，必須另取 native 證據 |
| Native crash／ANR | process 結束、Fatal signal、主執行緒阻塞 | 無；必須用 Android diagnostics 修 native 根因 |

「黑屏」驗收時要記錄黑屏範圍：`map-only`、`overlay-only`、`React-tree`、`Activity`。四者不得合併成一個 boolean。

## 3. 現行流程契約

```text
MapScreen
  ├─ openGroupMenu
  │   ├─ Android Alert：設定／離開／取消
  │   └─ Settings overlay：回到建立／加入
  └─ goHomeCreateOrJoin
      └─ RoleSelect
          ├─ Auth → replace Map
          └─ MyTeams → replace Map
```

目前 `goHomeCreateOrJoin` 使用 `navigation.navigate('RoleSelect')`。在重入流程中，這可能讓舊 `Map` route 留在 stack；spec 將這個行為視為待修正的高風險點。回首頁不是一般頁面跳轉，而是「結束目前 map session、建立新的 create/join session」的工作流程邊界，因此必須是 reset transaction。

## 4. 全 App 互動安全契約

### 4.1 Action API

所有會執行副作用的 button-like callback 使用同一個 runner：

```ts
type UiActionOptions = {
  screen: string;
  timeoutMs?: number;
  onBusyChange?: (busy: boolean) => void;
  onError?: (kind: 'error' | 'timeout') => void;
};

runUiAction<T>(
  actionId: string,
  task: () => T | Promise<T>,
  options: UiActionOptions,
): Promise<T | undefined>;
```

Runner 必須：

1. 在 task 前記錄 `ui_action_start`。
2. 同一 action 未完成時拒絕第二次執行。
3. 捕捉同步 throw 與 Promise reject。
4. 以 timeout 結束 UI busy；timeout 不可讓 spinner 永久存在。
5. 以 `finally` 執行 `onBusyChange(false)`。
6. 對晚到的 Promise 結果做 request token 檢查，不能覆蓋新 screen 或新 session 的 state。
7. 以 `ui_action_success`、`ui_action_error` 或 `ui_action_timeout` 結束事件。

Runner 不負責猜測錯誤文案、不把 error message 原文上傳、不自動重試有副作用的 mutation。

### 4.2 Button／Alert／Gesture 覆蓋範圍

- `Pressable`、`TouchableOpacity` 與同類元件：使用 `SafePressable` 或直接呼叫 runner。
- `Alert.alert` 的 button action：handler 內呼叫 runner；Android 保持最多三個 button。
- `ActionSheetIOS` callback：index mapping 只做同步選擇，真正的 navigation／mutation 交給 runner。
- backdrop、cancel、back、retry：仍走 runner 或明確的同步 safe handler，確保 overlay state 可收斂。
- swipe／drag end、Map imperative action、submit callback：視同 button action，不可因不是 `onPress` 就逃脫契約。
- 純粹 `setState` 且不會 throw、navigation、IO 或 native call 的 callback可維持最小實作，但必須列在 inventory 中。

### 4.3 使用者可見的恢復

| 失敗 | UI 行為 |
|---|---|
| sync／async action error | 保留目前 screen，busy 關閉，顯示可讀錯誤與 retry 或 cancel |
| timeout | 顯示「操作逾時」，提供 retry；不清空既有資料 |
| navigation reset failure | 保留目前 screen，記錄 route state，提供再次回首頁 |
| React render error | Root boundary 顯示 Retry；不得只留空 View |
| Map subtree error | Map 區域顯示 reload／回首頁，sheet 或 recovery banner 保持可操作 |
| process crash／ANR | 下次啟動讀取 exit reason／previous launch incomplete，不能在 JS 端假裝即時恢復 |

## 5. 導航與 Map session 契約

### 5.1 回首頁

`goHomeCreateOrJoin` 必須：

- 在同一 action transaction 內關閉 overlay／sheet；
- 使用 `navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] })`；
- 不呼叫 `leaveGroup`、不清除 session、membership 或使用者 profile；
- reset 完成後，舊 Map instance 不得再更新 route／overlay／location state；
- 連續點擊只產生一個 reset。

### 5.2 再進入地圖

- `RoleSelect → Auth` 可建立新的 Auth route；成功後由 Auth `replace('Map')`。
- `RoleSelect → MyTeams` 可進入隊伍選擇；成功後由 MyTeams `replace('Map')`。
- 每次流程完成後 route state 只能有一個當前 Map route。
- `GroupMap` 的既有 Android provider、`initialCenter` 鎖定與 Android callback ownership 不得回退。
- Map lifecycle 事件至少包含 mount、ready、loaded、unmount；同一 session 不得出現無限 remount。

### 5.3 Map fallback

Map fallback 必須是有限狀態：

```text
mounting → ready → loaded
    │        │
    └────────┴─ failure → fallback → user retry（最多一次連續 reset）
                                      └→ 回首頁
```

- `ready` 後超過診斷窗口未 `loaded` 只記錄 `map_loaded_timeout`，不能直接自動 remount。
- 使用者 retry 只重建一次 Map surface；若再次失敗，維持 fallback 並提供回首頁。
- 若 `logcat` 顯示 native crash，停止增加 JS retry，轉 native root-cause A/B。

## 6. Error Boundary 與 telemetry

現有 `AppErrorBoundary` 與 `installGlobalErrorLogger` 保留，補充以下資料：

- `actionId`、screen、route name、route key；
- launch phase、appState、map lifecycle；
- action duration、timeout／error category；
- build、runtime、update、device model 等既有 sanitized metadata。

禁止上傳：token、使用者 ID、精確座標、完整 error stack、原始 API response。事件只使用既有 performance／diagnostic outbox 與既有 `logEvent`／`logError`。

最少事件集合：

```text
ui_action_start
ui_action_success
ui_action_error
ui_action_timeout
navigation_reset
map_mount
map_ready
map_loaded
map_unmount
map_surface_failure
previous_launch_incomplete
```

## 7. 測試規格

### 7.1 純測試／契約測試

- `navigationInteractionContract.test.ts`：回首頁使用 reset、不可保留多個 Map route、membership 不被清除。
- `uiActionContract.test.ts`：sync throw、reject、timeout、double tap、finally cleanup、late result。
- `buttonInventoryContract.test.ts`：高風險 screen 不得新增裸露的 async button handler。
- `androidMapContract.test.ts`：provider、location callback ownership、map lifecycle、不得無限 remount。
- `performanceRegression.test.ts`：GPS sample 不得造成 MapView initial center 或 native callback churn。

### 7.2 Pixel 實機情境

| 情境 | 次數 | 必須觀察 |
|---|---:|---|
| 更多／設定／回首頁／重新進地圖 | 10 | route state、Map black、React black、map mount count |
| 每個主要 screen 的 submit／cancel／retry | 各 10 | double tap、永久 spinner、錯誤後可恢復 |
| foreground／background | 10 | watcher、channel、Map ready／loaded、exit-info |
| 離線後恢復 | 10 | timeout、retry、資料不被清空 |
| theme 不變與 theme 切換 | 各 10 | 不必要 remount、surface 是否遺失 |

每輪保存 `logcat-all`、`logcat-crash`、`gfxinfo`、`exit-info` 與螢幕錄影。若只看到 Map 黑，標記 `map-only`；若整個 Activity 結束，必須有 native exit evidence。

### 7.3 Acceptance criteria

- 主要 button-like interaction 100% 有 inventory；高風險入口 100% 通過 safe action contract。
- 受影響重入流程黑 Map／黑整個 App：0/10。
- 任一 action 逾時後永久 loading：0/10。
- 同一 action double submit：0 次。
- Route stack 多個當前 Map：0 次。
- JS render error：有 sanitized error、有 retry、有可操作 fallback。
- native crash／ANR：0/10，並有 crash buffer／exit-info 證據。
- frozen frame >700 ms：0 次；發生時不得以 UI retry 當作通過。

## 8. 明確不採用的方案

- 不在每個按鈕各自加一份 `try/catch`、`setTimeout`、toast；這會造成漏修與行為分裂。
- 不用自動週期 remount MapView 來掩蓋 surface leak。
- 不把所有黑屏都歸因於 Google Maps renderer，也不在沒有 native stack 前切換 renderer／New Architecture。
- 不把 `AppErrorBoundary` 當成 event handler、native crash 或 ANR 的萬用攔截器。

## 9. 未來方向與風險

- 未來可把互動事件與 Android vitals、Map renderer、OTA update 聚合成 release gate，並增加端到端操作 replay。
- 風險最高的是漏遷移的裸露 callback、不可取消的底層 Promise、以及特定 Pixel／Google Maps／GPU 組合的 native failure。
- 若完成 JS action boundary 後仍有 process crash，後續工作應轉到 native lifecycle、renderer、Play Services 與簽章／API key 證據，不再擴張按鈕 wrapper。
