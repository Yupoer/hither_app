# Hither TestFlight 交接（2026-07-13）

## 本次已完成

- iOS bundle ID 固定為 `app.hither.mobile`，APNs entitlement 為 `production`。
- APNs production key、Key ID、Team ID、bundle ID、environment 與 webhook secret 已存入 Supabase Edge Function Secrets；私鑰未寫入 repository。
- `send-push` Edge Function 已部署，資料庫 webhook 透過 Vault 讀取 URL 與 secret。正式環境連線測試已通過 webhook 驗證並進入群組授權檢查。
- 到集合點距離 `<= 30m` 判定抵達；抵達狀態在同一集合點內為 sticky，切換集合點才重設。
- 旅程中持續背景定位，更新距離、ETA、進度與抵達狀態。
- Live Activity／Dynamic Island 顯示集合地點、距離、ETA、交通方式、進度、已抵達人數與隊員頭像明暗；Activity push token 會登錄 Supabase。
- App 內 Quick Commands、抵達、脫隊與旅程更新均接到多人正式推播流程；非開發版不再重複發本機 Realtime 通知。
- Supabase Auth Site URL 為 `hither://auth/callback`，正式 callback 已在 Redirect URLs；Google 登入仍由 Supabase Auth provider 處理。
- `eas.json` 已具備 development、preview、production 與 submit profiles。

## 下一個部署 Session 尚需的資料

### 1. Expo 帳號與 EAS project link（必要）

目前 `app.json` 沒有 `expo.owner` 與 `extra.eas.projectId`。在 `apps/mobile` 執行：

```powershell
eas login
eas project:init
eas project:info
```

`eas project:init` 會建立或連結 EAS project，並把 project ID 寫回 Expo config。若已在 Expo Dashboard 建立 Hither，請在互動提示選既有專案，不要再建第二個。

官方文件：[EAS CLI `project:init`](https://docs.expo.dev/eas/cli/)、[EAS Build setup](https://docs.expo.dev/build/setup/)

### 2. Apple signing credentials（必要）

下一個 Session 可讓 EAS 互動式產生／管理 iOS Distribution Certificate 與 Provisioning Profile：

```powershell
eas credentials --platform ios
```

選 `production`，再選 build credentials 的完整設定。現有 APNs `.p8` 只負責推播，不能取代 distribution certificate 或 provisioning profile。

### 3. App Store Connect app record（必要）

在 App Store Connect 的 Apps 建立 Hither iOS app，bundle ID 選 `app.hither.mobile`。若已存在，下一個 Session 只需確認名稱、SKU、主要語言與 bundle ID。

### 4. App Store Connect 上傳認證（二選一）

- 互動部署：使用 Apple ID + 2FA，EAS 依提示處理。
- 非互動／自動化部署：建立獨立的 App Store Connect API key，提供其 `.p8`、Key ID、Issuer ID。路徑是 App Store Connect → Users and Access → Integrations → App Store Connect API。私鑰只能下載一次。

這把 key 與 `AuthKey_YDV8WF53XN.p8` 是不同用途，不能互換。官方文件：[Apple 建立 App Store Connect API key](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)

## 建置與上傳

工作目錄：`apps/mobile`

```powershell
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

也可在 credentials 與 App Store Connect record 已確認後使用：

```powershell
eas build --platform ios --profile production --auto-submit
```

`--auto-submit` 只會上傳到 App Store Connect／TestFlight，不會自動送公開 App Review。官方流程：[Expo iOS production build 與 TestFlight](https://docs.expo.dev/tutorial/eas/ios-production-build/)

## TestFlight 實機驗收

至少兩台不同 Apple ID／Supabase 使用者的實機：

1. 安裝 TestFlight production build，允許通知、Live Activities 與「永遠」位置權限。
2. 建立／加入同一群組，確認其他成員位置以 Supabase Realtime 更新。
3. 隊長啟動旅程，確認鎖定畫面與 Dynamic Island 顯示地點、距離、ETA、進度、交通方式與頭像。
4. App 進背景及鎖屏後移動，確認資料仍更新。
5. 分別在 30.01m、30m、29.99m 附近驗證；30m（含）內應抵達，離開後同一目的地仍保持抵達。
6. 第二位隊員抵達後，第一位隊員的 Live Activity 應更新抵達數與頭像明暗。
7. 驗證 App 內 Quick Commands、抵達通知、脫隊通知與自訂指令不會重複發送。
8. 結束旅程後，Live Activity 應結束，背景定位停止。

## 已知驗證邊界

目前尚未產生 TestFlight production device token 與 Activity push token，因此無法在這台 Windows 開發環境對 Apple APNs 做最後一跳實機驗證。程式、Supabase secrets、Vault webhook、Edge Function 與資料庫 transaction boundary 均已驗證；最後一跳必須在 production-signed TestFlight 實機完成。

## 風險與後續

- 使用者拒絕「永遠」定位時，鎖屏後 ETA／距離可能停止更新；App 已顯示權限提示，仍需 TestFlight 實測 iOS 的節流行為。
- APNs 與 App Store Connect keys 必須定期盤點、撤銷不用的 key，且不得提交 repository。
- Supabase 目前另有既存 security advisors（anonymous sign-in、leaked password protection、部分 SQL function／RLS 建議），不阻擋這次內測，但公開上線前應逐項關閉。
- 後續可增加推播投遞 observability、APNs error rate／token invalidation dashboard，以及真實路線初始距離在交通方式切換時的版本化策略。
