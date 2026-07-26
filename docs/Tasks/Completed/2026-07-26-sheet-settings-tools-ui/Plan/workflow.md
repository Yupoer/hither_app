# Hither workflow — sheet/settings/tools UI

## Request

在 sheet 開啟後簡化更多與設定導覽；將地圖與旅程的開關集中到工具頁；移除脫隊示警設定；並嘗試以 iOS 26 Liquid Glass 風格整合成員、路線、工具選擇器。

## Orchestration baseline

- Original project root: `C:\Users\alexs\Desktop\BZ\hither`
- Git repository root: `C:\Users\alexs\Desktop\BZ\hither\hither_app`
- Original branch: `agent/ota-01-09-product-batch`
- Original HEAD: `1b0fc8d8698a6ceef4c1df437183d63677b8e6ae`
- Base ref: `origin/master`
- Base SHA: `2d4afc0ffb4607b412dae75d8cb903d9a4ba3d7f`
- Feature worktree: `C:\Users\alexs\Desktop\BZ\hither\hither_app\.worktrees\hither-2026-07-26-sheet-settings-tools-ui`
- Feature branch: `agent/hither/2026-07-26-sheet-settings-tools-ui`

## Preflight

- Original root was dirty; it remains untouched and read-only for this task.
- `git fetch origin master` first failed inside the sandbox, then succeeded with approved external network access.
- Hither workflow tool check passed: Git, task directories, release queue, Grok, Codex, `to-spec`, `to-tickets`, and commit/OTA skill all available.
- Implementation and validation are isolated to the feature worktree.
