# 10 — 建立 Task-scoped Commits 並合併 master

**What to build:** 將已通過整合 gate 的切片以可審查 commit 邊界提交，確認 staged scope 與 WIP manifest 一致，再把整合結果合併至本地 master 並保留主線行為。

**Blocked by:** 09 — 執行整合驗證並建立外部 Gate Matrix。

**Status:** ready-for-agent

- [ ] 每個 commit 只包含對應切片與必要測試／文件，使用明確 pathspec stage，不使用 `git add -A`。
- [ ] 每次 commit 前檢查 staged diff、禁止提交項目、secrets scan 與 WIP manifest mapping。
- [ ] commit 訊息與順序能表達 server-before-client、legacy disable last 及獨立 `support-site` 邊界。
- [ ] 先確認本地 master 可 fast-forward 到最新 `origin/master` 或以可審查方式同步，再合併整合分支。
- [ ] merge 後確認 Expo Dev Client、preview、package lock、Expo dependencies、runtimeVersion 0.1.5、App Store 設定與最新 master 功能沒有回退。
- [ ] 在 merge 後的 master 重跑必要 smoke／regression／typecheck／diff check，保存 merge commit SHA 與結果。
- [ ] 未授權的 production deploy、OTA、build、TestFlight 或 App Store submit 不因 merge 自動執行。

