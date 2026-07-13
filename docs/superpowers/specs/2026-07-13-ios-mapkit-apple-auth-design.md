# iOS MapKit 與 Sign in with Apple 設計

## 範圍

本次只支援 iOS，不新增或修改 Android 地圖、搜尋、路線或登入行為。沿用既有 Expo 54、`react-native-maps`、Supabase Auth 與自訂 `HitherMaps` Expo Module，不替換整張地圖元件。

## MapKit 地點搜尋

- `DestinationSearch` 維持既有介面與 debounce 行為。
- iOS Development Build 優先呼叫 `HitherMaps.searchPlaces`，由 `MKLocalSearch` 處理自然語言與類別搜尋，例如「餐廳」。
- 搜尋範圍以裝置定位或目前選取集合點附近為中心。
- MapKit 失敗時保留現有 Photon／Nominatim fallback，避免搜尋完全不可用。

## 路線、距離與 ETA

- 擴充 `HitherMaps.getDirections`，輸入起點、終點與交通模式，輸出：
  - `distanceMeters`
  - `expectedTravelTimeSeconds`
  - `points` Polyline 座標
- 支援目前 UI 已有的步行、開車與大眾運輸模式；模式切換時重新查詢。
- 使用者選取集合點或啟動導航後，查詢「目前裝置定位 → 選取集合點」並在地圖畫出該使用者的一條 Polyline。
- 卡片上的自身 ETA 與距離優先使用 MapKit 回傳值；無路線或查詢失敗時才使用既有直線距離推估。
- 每位成員的 ETA 必須依「該成員最新定位 → 目前集合點」各自計算，不以自身位置或其他成員作為終點。
- 成員 ETA 查詢以座標、集合點與交通模式作快取，同一組輸入不重複請求；定位或集合點改變才更新。單一成員查詢失敗時只讓該列退回直線推估，不影響其他成員。
- 地圖只繪製目前裝置使用者的路線，不同時繪製所有成員路線。

## 地圖鏡頭

- 一般置中、顯示全部成員等既有操作不變。
- 新增地點確認卡上的定位按鈕改用 `animateCamera`：目標為待新增地點、`pitch` 為 45 度，並給予可辨識路線與周邊街廓的縮放高度。
- 若 MapKit 路線存在，鏡頭優先框入自身與集合點；使用者再次點確認卡定位按鈕時才切換至 45 度斜角。

## Sign in with Apple

- 安裝與 Expo SDK 54 相容的 `expo-apple-authentication`。
- `app.json` 設定 `ios.usesAppleSignIn: true` 並加入 config plugin。
- 登入畫面在 Google 按鈕旁顯示 Apple 原生按鈕；只在 Apple Authentication 可用時顯示。
- 呼叫 `AppleAuthentication.signInAsync`，要求姓名與 email，將 `identityToken` 交給 Supabase `signInWithIdToken({ provider: 'apple' })`。
- 使用 nonce 防止 token replay。
- Apple 只在首次授權提供姓名；當次立即保存至 Supabase user metadata 與既有 `profiles.nickname`。後續未回傳姓名時沿用既有 profile，缺少名稱才使用 email 前綴或既有安全預設。
- 使用者取消登入視為正常取消，不顯示錯誤 Alert；其他錯誤使用既有登入錯誤介面。

## 錯誤處理

- MapKit 原生錯誤傳回 JS，由 JS 層降級，不讓地圖或卡片崩潰。
- 使用序號或取消旗標避免較舊的非同步路線結果覆蓋新目的地／新交通模式。
- 沒有定位時不查路線，維持地點與成員 UI，ETA 顯示不可用狀態。
- Apple credential 缺少 identity token 時中止登入並回報可理解錯誤。

## 驗證

- TypeScript typecheck 與既有 Jest 測試必須通過。
- 新增最小測試覆蓋路線 fallback、過期結果保護，以及 Apple 登入成功／取消資料流。
- iOS Simulator 驗證 MapKit 搜尋、Polyline、真實 ETA、交通模式切換與 45 度鏡頭。
- Sign in with Apple 可在 Simulator 做有限驗證，最終以實機或 TestFlight 驗證 entitlement、首次姓名與再次登入。

## 不做事項

- Android Map／Places／Directions／Apple OAuth。
- 逐步 turn-by-turn 導航、語音提示、偏航自動重算。
- 同時顯示所有成員 Polyline。
- Apple 網頁 OAuth、Services ID、`.p8` secret 與網頁 callback。

## 未來方向與風險

- 未來可加入導航期間節流重算、偏航偵測與多集合點串接路線。
- 成員數增加時，每人一筆 MapKit 路線請求可能觸及服務節流；屆時需限制併發、延長快取或只計算可見成員。
- MapKit 在特定地區或交通模式可能沒有可用路線，必須保留 fallback。
- Apple 首次姓名資料不可重取，首次登入保存失敗時需要讓使用者補填暱稱。
