# Hither 工作規則

- Git repo 為 `hither_app`；mobile 位於 `apps/mobile`。以遠端 `master` 為整合基準。詳細步驟見 [README](README.md#development-and-release-workflow)。
- 完整開發先在本地隔離工作樹實作、檢查差異、審查並修復，再執行受影響測試。GitHub Issue 可用於追蹤，但不以 Issue、PR 或雲端審查作為每個任務的固定階段。
- 審查涵蓋行為、資料與權限、相容性、無障礙和測試語意。非平凡邏輯變更補行為測試；保留適用的 acceptance-map、changed-function coverage 與 CI gate。相同來源的有效結果不重跑。
- 把已審查提交推至 `deliver/<task>` 分支。有 PR 時審查 PR，等待其合併樹的 `ci-required` 通過後合併；沒有 PR 時在該分支手動執行 CI workflow，等待 `ci-required` 通過，再核對遠端 `master` 沒有前進，在乾淨的 `master` 工作樹 fast-forward 並普通 push。單純推送 `deliver/` 不啟動完整 CI。若 GitHub 保護規則阻擋就保留結果並回報，不繞過保護或 force push。遠端 `master` CI 失敗時修復並重驗，不宣稱交付完成。
- 保留無關 dirty work、staged files、stash、ignored files 和其他 active worktree。只整理已確認屬於本任務且已交付的資源；不得 reset、auto-stash 或清理其他 owner 的工作。
- 完整 iOS 產品交付在固定遠端 SHA 後判斷全部尚未交付差異。現有 binary 能完整承載時發布 `production` OTA；有原生或相容性缺口時優先使用手動 `.github/workflows/cd-ios-testflight.yml`，在 GitHub `xcode-27` runner 執行 `preflight`、`build-only` 或 `submit`。此雲端路徑尚未完成簽署建置、完整冷啟動、Apple processing 與實機驗收驗證，不能以 branch CI 或 preflight 代替；缺少必要驗證時先回報，不自動改用 Mac。既有 `mac-codex` 僅作明確要求時的備選。後端相依變更先部署並驗證。純文件、純後端或明確 Git-only 範圍不製造 OTA 或 IPA。
- 完整發布以 [hither-release](C:/Users/alexs/.codex/skills/hither-release/SKILL.md) 的現有交付入口執行；明確指定的平台、channel 或 Git-only／OTA-only／build-only 範圍優先。commit 與 push 本身不會自動發布。
- 分開核實並回報本地審查、測試、遠端 master、CI、OTA 或 TestFlight 狀態與實機驗收。Jest、typecheck、archive 或 Apple processing 均不等於實機已驗收。

## 註解與相容程式碼

- 優先用清楚的名稱、型別與控制流程表達意圖。不新增重述下一行、階段旁白、變更日誌、BUG／OTA 標籤、已註解掉的程式碼或猜測性的未來 TODO。
- 保留法律／授權標頭、工具會讀取的 directive 或 metadata、公開 API 的單位與回呼契約，以及目前仍成立的非顯然平台、SDK、協定、權限或資料完整性限制。註解說明原因，不替不明確的程式結構辯解。
- 遇到 workaround、IMPORTANT、do not remove 或相容性說明，先追查精確符號、目前 caller、同版依賴與既有證據。自有程式的問題用最小命名、型別或結構修正；外部限制未釐清時保留現行行為並記錄缺口。不得為配合過時註解改寫正確行為。
- 測試驗證可觀察行為、資料或真正的結構契約，不斷言一般註解、歷史標籤或 JSDoc 散文。不得把過時字串塞進註解讓測試通過。已有行為覆蓋時刪除散文斷言，不新增同義案例。
- 測試替身遵守現行介面與資料合約。不得在產品程式增加只為舊 mock、不完整 fixture 或單元測試覆蓋而存在的 fallback、optional 檢查、舊 API 或無效參數。刪除前核對正式 caller，保留真實平台能力、持久化升級、授權及離線資料邊界。
- lint／型別抑制須有明確的規則誤判、樣式理由或外部限制。正確性與安全問題修在來源，不以目錄 glob 關閉規則讓未來新檔自動豁免。既有 baseline 依實際診斷逐批縮小，不為清理抑制擴成無關重構。
- 完成前審查本次差異中的註解、死入口、測試與抑制。純註解清理確認執行內容不變；程式清理保留實際需求並執行受影響檢查。沒有正式用途的程式不因舊測試而保留。
