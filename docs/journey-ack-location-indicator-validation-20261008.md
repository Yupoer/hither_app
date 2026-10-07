# 開始後自動暫停與定位藍圈修復

日期：2026-10-08（Asia/Taipei）。直接在本機 master 延續使用者修正需求；`git pull --ff-only origin master` 確認基準為 `b1ff49423c0b6c9f49eedcd9d2f744c3b579488a`。保留 `.tmp/`、`.wrangler/` 與其他任務資料。

## 已重現的自動暫停

新增集合點後開始，畫面與 SQLite 本機投影進入 going。開始操作得到後端 ACK 後，同步佇列刪掉 receipt，`hasPendingTeamOperation` 變為 false。舊程式在這一步無條件清掉 optimistic target；若 navigation session 訂閱仍為 null 或舊目標，行程立即顯示 paused。獨立 QA 回歸測試先確認失敗，且沒有呼叫 End；後端成功不代表新的 session 訂閱已完成。

修復需要保留本機 going 與目標，直到同一目標的新 session 或明確停止狀態已完成投影；不能把 outbox 清空當作停止命令。手動停止、目前 session 的完成/取消、目的地移除、帳號與群組/分組切換仍須停止。

## 定位權限與背景活動

使用者所指時間外的藍圈是 iOS 背景定位使用指示，不是準確度等級。現有 `prepareBackgroundJourneyPermissions` 在一般位置分享時呼叫原生 `prepareBackgroundLocation(true)`，會建立 `CLBackgroundActivitySession`；只 stop updates 不會釋放 activity session。因而即使沒有進行中集合點也可能顯示藍圈。

這輪把 OS 授權準備、導航 activity session 與位置更新分開。MapKit 前景定位藍點保留；只有有效進行中集合點才持有導航背景活動。其他狀態使用一般位置分享；一般背景分享透過既有 Always 授權和 Expo CLLocationManager 路徑，不建立導航 activity session。關閉分享會撤銷所有定位 owner 與背景活動。沒有 Always 授權時不能保證持續背景定位且沒有藍圈，因此不能透過隱藏指示旗標冒充此能力。

參考：[Apple showsBackgroundLocationIndicator](https://developer.apple.com/documentation/corelocation/cllocationmanager/showsbackgroundlocationindicator)、[Apple Core Location 狀態列控制](https://developer.apple.com/library/archive/qa/qa1965/_index.html)。

## 粒子

維持左往右與前輪減半的半徑。前輪平均約 10.714 顆/秒，實際每秒 10 或 11 顆；改為固定每秒 22 顆（45.4545ms 間隔），位置使用均勻隨機雜湊，不使用固定順序的高度帶。renderer 容量必須容納發射窗的全部粒子；暫停不推進動畫時鐘。

## 正式資料庫只讀診斷

本輪查詢近六小時 core operations：5 add_destination、4 delete_destination、2 start_gathering、1 record_arrival、1 complete_destination，全為 accepted，沒有 terminal_reason；沒有 end_gathering。兩個 start_gathering 時間為台北 01:40:13 與 01:40:42。diagnostic_events 沒有事件。無法以這些紀錄識別使用者本次裝置操作，但沒有後端拒絕或收到自動停止操作的證據；本機自動暫停已由回歸測試直接重現。

只讀正式資料；不改 schema、RLS、會員資料或歷史紀錄。

## 驗證與發布邊界

延續 build 76 / runtime 0.1.11 / production 的實際原生相容基準；完整 diff 必須沒有原生程式、依賴、權限或 app config 變更才可 OTA。前輪 Expo 線上版本 gate 的八個 upstream patch 建議仍為獨立限制；不為此次 JS 修復更換原生依賴或跳過 CI。

Jest 與 OTA 服務端發布不能代替實體 iPhone 的藍圈與行程操作驗收；本次未取得使用者裝置套用 update ID 或畫面錄影。

本輪唯讀發布預檢再次核對：Mac receipt/IPA metadata 仍為 source 164ca5c、build 76、runtime 0.1.11、production，Apple VALID / internal IN_BETA_TESTING；IPA size 40077971 bytes 與 mtime 未變，沿用前輪已匹配 SHA-256 的證據。production EAS channel 仍指向前輪 group b581497e-1a84-48de-a3e6-dca670efdf98。新增 JS 定位調整只呼叫 build 76 已存在的 prepare/has/start/stop 原生 API。

獨立 QA 已記錄 ACK 投影缺口與 passive owner 的 red→green；新增兩個回歸測試檔已涵蓋 ACK/空資料/正式 terminal/重進頁面/移除目標，以及 native preparation、Pause→Start、Share OFF 延遲競態、未授權 Always 與 cold background。原始結果保存在 `.tmp/qa-validation-20261008-v2/`；完整最終 gate 由交付回報核對。

最終修正還區分 session 查詢的 null 與正式 terminal row，並持久化停止紀錄；原子 recovery 的版本不會降級 SQLite 或 React 投影。本機 End2 後即使舊 going 畫面重新 render，下一個 Start 仍使用版本 3。同目標但不同 session 的交接只比較 server 時鐘，不用 device 時鐘判定；2099 年裝置時鐘與 2026 年伺服器的回歸案例已通過。背景同樣拒絕舊 A 行程資料停止或覆蓋新 B 本機 Start。

最終獨立 review 沒有剩餘 actionable finding；定位 focused 6 suites / 106 tests、本機 focused 7 suites / 111 tests、獨立新增 2 suites / 19 tests 各自通過（測試集合有重疊，不加總）。穩定來源 TypeScript、test:meta、verify:runtime、git diff --check 通過。完整 coverage gate 在固定本機 commit 後執行，通過才 push / OTA。
