# Hither 工作規則

- Git repo 為 `hither_app`；mobile 位於 `apps/mobile`。以遠端 `master` 為整合基準。詳細步驟見 [README](README.md#development-and-release-workflow)。
- 完整開發先在本地隔離工作樹實作、檢查差異、審查並修復，再執行受影響測試。GitHub Issue 可用於追蹤，但不以 Issue、PR 或雲端審查作為每個任務的固定階段。
- 審查涵蓋行為、資料與權限、相容性、無障礙和測試語意。非平凡邏輯變更補行為測試；保留適用的 acceptance-map、changed-function coverage 與 CI gate。相同來源的有效結果不重跑。
- 把已審查提交推至 `deliver/<task>` 分支，等待該提交的 `ci-required` 通過。核對遠端 `master` 沒有前進後，在乾淨的 `master` 工作樹 fast-forward 到同一提交並普通 push。若 GitHub 保護規則阻擋就保留結果並回報，不繞過保護或 force push。遠端 `master` CI 失敗時修復並重驗，不宣稱交付完成。
- 保留無關 dirty work、staged files、stash、ignored files 和其他 active worktree。只整理已確認屬於本任務且已交付的資源；不得 reset、auto-stash 或清理其他 owner 的工作。
- 完整 iOS 產品交付在固定遠端 SHA 後判斷全部尚未交付差異。現有 binary 能完整承載時發布 `production` OTA；有原生或相容性缺口時沿用既有 `mac-codex` Mac 交接與完整 Release 驗證。另有手動 `.github/workflows/cd-ios-testflight.yml` 可在 GitHub `xcode-27` runner 執行 `preflight`、`build-only` 或 `submit`；此雲端路徑尚未完成簽署建置、完整冷啟動、Apple processing 與實機驗收驗證，不能以 branch CI 或 preflight 代替。後端相依變更先部署並驗證。純文件、純後端或明確 Git-only 範圍不製造 OTA 或 IPA。
- 完整發布以 [hither-release](C:/Users/alexs/.codex/skills/hither-release/SKILL.md) 的現有交付入口執行；明確指定的平台、channel 或 Git-only／OTA-only／build-only 範圍優先。commit 與 push 本身不會自動發布。
- 分開核實並回報本地審查、測試、遠端 master、CI、OTA 或 TestFlight 狀態與實機驗收。Jest、typecheck、archive 或 Apple processing 均不等於實機已驗收。
