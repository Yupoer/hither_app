# Hither docs

工作任務、Spec、ticket、code review **一律走 GitHub Issues / PRs**（Sol／Luna 流程）。  
本目錄只放**長期仍需要查閱**的產品／架構／運維／設計系統資料。

## 根目錄 Markdown

| 檔案 | 用途 |
| --- | --- |
| [`README.md`](./README.md) | 本索引；說明 `docs/` 邊界（什麼該放 GitHub） |
| [`PRODUCT.md`](./PRODUCT.md) | 產品定位、策略、核心體驗與功能方向（PM 觀點） |
| [`product-decision-log.md`](./product-decision-log.md) | 已確認／未定案的產品決策與取捨（文件衝突時以此為準） |
| [`current-app-functional-architecture.md`](./current-app-functional-architecture.md) | **以程式碼為準**的功能與架構盤點（模組邊界、平台能力） |
| [`android-release-runbook.md`](./android-release-runbook.md) | Android EAS build／secrets／驗收指令手冊 |
| [`apns-live-activity-setup.md`](./apns-live-activity-setup.md) | APNs 推播與 Live Activity 設定／切換手冊 |

## Hither Design System

路徑：[`Hither Design System/`](./Hither%20Design%20System/)

| 路徑 | 用途 |
| --- | --- |
| `readme.md` | 設計系統總覽與使用說明 |
| `SKILL.md` | Agent／工具讀取設計系統時的 skill 入口 |
| `design-system.html` / `styles.css` | 可瀏覽的設計系統頁面與樣式 |
| `_ds_manifest.json` / `_ds_bundle.js` / `_adherence.oxlintrc.json` | DS 打包與 lint 輔助設定 |
| `tokens/*.css` | 設計 token（色、字、間距、玻璃、動效等） |
| `guidelines/*.html` | 設計準則頁（色板、字級、radius、glass…） |
| `components/**` | 元件參考實作（core／forms／glass／hither） |
| `templates/hither-map-screen/` | 地圖主畫面 HTML 模板原型 |
| `ui_kits/hither_ios/` | iOS 畫面級 UI kit 原型（MapHome、Onboarding…） |

## 不要放這裡

- 進行中或歷史 task／ticket／Spec → **GitHub issue**
- 實作報告、code review → **PR comment／review**
- 一次性 handoff／QA matrix／release queue → issue 或 PR；完成後不保留本地副本
