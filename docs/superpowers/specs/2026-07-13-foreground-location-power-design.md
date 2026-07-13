# 前景定位省電與手動刷新設計

## 目標

降低 Expo Go 前景測試時的定位耗電，同時保留使用者主動取得最新群組位置的能力，並在成員清單顯示位置資料新鮮度。

## 定位架構

- 只保留 `expo-location` 的原生定位 watcher；關閉 `react-native-maps` 的 `showsUserLocation`，避免兩套 Core Location／Fused Location 來源同時運作。
- watcher 僅在 AppState 為 `active` 且已有群組時啟用，進入背景立即移除，回到前景重新建立。
- 預設使用 `Balanced`、50 公尺距離門檻、Android 30 秒最短間隔。
- 使用者手動開啟「高精準模式」後改用 `High`、10 公尺距離門檻、Android 5 秒最短間隔。
- 偏好使用新的 `pref.highAccuracy`，預設為 `false`；不反向解讀舊的 `pref.powerSaver`，避免舊值造成模式顛倒。

## 地圖與手動刷新

- 關閉地圖原生藍點後，不再排除目前使用者的成員 Marker，以既有成員 Marker 顯示自己。
- 成員標題列右側新增刷新按鈕。
- 點擊後依目前精度模式取得並上傳自己的單次位置，再重新讀取群組狀態。
- 按鈕執行期間顯示 spinner、停用重複點擊；錯誤時顯示既有失敗提示。
- 此功能只重新讀取其他成員已上傳的位置，不喚醒其他手機。

## 最後更新時間

- 每位成員列使用現有 `lastUpdated` 顯示位置新鮮度。
- 顯示級距：剛剛、N 分鐘前、N 小時前；超過 24 小時固定顯示「過久未更新」，沒有時間則顯示「尚無位置更新」。
- 相對時間共用畫面現有 30 秒 tick；超過 24 小時的文字不再細分，不增加網路請求。

## 驗證

- 純函式測試涵蓋兩種定位 profile 與相對時間邊界。
- Hook 元件測試驗證 watcher 在背景移除、回前景恢復，以及手動刷新順序。
- 執行 Jest、TypeScript typecheck 與 Expo lint。

## 非目標

- 不完成目前仍為空實作的 `HitherLocation` 自訂原生模組。
- 不加入背景定位、Always 權限或推播喚醒其他成員。
- 不新增套件。
