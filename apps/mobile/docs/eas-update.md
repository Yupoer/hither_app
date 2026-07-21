# EAS Update (OTA)

Hither 已接上 **EAS Update**。下一次 **EAS Build → Submit / TestFlight** 的 binary 會內建 OTA 能力；之後純 JS/TS 改動可用 `eas update` 推送，不必每次重編 native。

## 設定摘要

| 項目 | 值 |
|------|-----|
| Project ID | `0f62ed14-1f2e-4d7b-b5b6-4eda273f2e35` |
| Update URL | `https://u.expo.dev/0f62ed14-1f2e-4d7b-b5b6-4eda273f2e35` |
| `runtimeVersion` | **手動字串**（bare workflow 不支援 policy）— 目前 `"0.1.3"`，應與 `expo.version` 同步 |
| Channels | `development` / `preview` / `production`（寫在 `eas.json` **build** profiles 的 `channel`；勿加頂層 `update` key） |
| 套件 | `expo-updates`（SDK 54 相容版） |

原生開關：`ios/Hither/Supporting/Expo.plist` 的 `EXUpdatesEnabled=true`，並帶 `EXUpdatesURL` + `EXUpdatesRuntimeVersion`（解析後的 app version 字串）。

## 第一次啟用（必須）

1. 用**含此設定的原始碼**跑一次 EAS build（preview 或 production）。
2. 安裝到裝置 / TestFlight。
3. 之後同 `runtimeVersion`（同 `version`）的 pure-JS 變更才可用 OTA。

**現有舊 binary（OTA 關閉時編出的）收不到 update** — 一定要先裝新包。

## 發佈 OTA

```bash
cd hither_app/apps/mobile

# TestFlight / internal preview builds
npm run update:preview -- --message "fix: …"

# App Store / production channel builds
npm run update:production -- --message "fix: …"
```

等價：

```bash
eas update --channel preview --message "…"
eas update --channel production --message "…"
```

裝置行為（預設）：

- 冷啟動時檢查 update（`checkAutomatically: ON_LOAD`）
- 原生最多等 `fallbackToCacheTimeout: 3000` ms 下載並在同一次啟動套用；逾時則先開舊包
- JS 端 `startOtaUpdateBootstrap()` 再跑一輪 `check → fetch → reload`，前景回到 active 也會檢查（避免只關開仍停在舊包）
- 設定頁偵測到可用 OTA 時會顯示「立即更新」；點選後 `fetchUpdateAsync` + `reloadAsync` **立刻套用並重載**（無更新時不顯示按鈕）

手動驗證：開 app 等幾秒（可自動 reload）；或設定頁「立即更新」。

**TestFlight 收不到更新時先查：**

1. Binary 的 `runtimeVersion` 必須是字串 `0.1.3`（指紋 hash 的舊包只收 fingerprint OTA）
2. Build profile channel：`production` / `preview` / `diagnostic` 要與 `eas update --channel` 一致
3. 設定頁 OTA 列：應顯示「已套用 · xxxxxxxx」而非一直「內建包」

## 什麼可以 OTA / 什麼不行

| 可 OTA | 需新 binary（改 `version` + EAS build） |
|--------|----------------------------------------|
| JS/TS 畫面、邏輯、樣式 | 新增 / 升級 native module |
| 文案、i18n、多數 asset | 改原生權限、entitlement、Info.plist |
| 純 RN 修 bug | Live Activity / 原生 extension 變更 |
| | Expo SDK 大升級、Pod / 原生依賴 |

## `runtimeVersion` 注意

- 專案是 **bare workflow**（有 `ios/`）→ **不能** 用 `{ "policy": "appVersion" }`，必須手動字串。
- 慣例：讓 `runtimeVersion` === `expo.version`（目前都是 `0.1.3`）。
- 升 `version`（例如 `0.1.3` → `0.1.4`）時，**同時**改：
  1. `app.json` → `version` + `runtimeVersion`
  2. `ios/Hither/Supporting/Expo.plist` → `EXUpdatesRuntimeVersion`
  3. 出新 native build；之後 OTA 綁新 runtime
- 舊 runtime 上的 OTA 不會進到新 binary（避免原生不相容）。

## 除錯

- 設定頁「版本」可對照 store 版號；OTA 本體可用 `expo-updates` 的 `Updates.updateId` / `Updates.isEmbeddedLaunch`（開發時可暫時 log）。
- [EAS Update 除錯](https://docs.expo.dev/eas-update/debug/)
- 「No compatible updates」→ channel 或 `runtimeVersion` 對不上 binary。
