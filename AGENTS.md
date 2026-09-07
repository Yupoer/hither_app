# Hither 工作規則

- Git repo 為 hither_app；mobile 位於 apps/mobile。以 remote default branch 為整合基準。
- 完整任務使用 workflow-controller：sol-plan-publish → implement-integration-pr → sol-review-land；未通過回實作，通過才 merge，接著同步及清理。只有 Release skill 使用 gpt-6-astra low；其餘 workflow phase 使用 gpt-5.6-luna max。
- GitHub Issue／PR 是任務狀態來源。一個 parent 一個 branch／worktree／PR，不同 parent 可並行。只讀當前任務需要的規格與資料。
- 在專用 worktree 修改；主工作樹 dirty 不阻塞獨立工作，也不得為交接 stash 無關修改。合併後主工作樹安全 fast-forward；其他 active worktree 由 owner 在乾淨交接點同步 master。
- 完整流程已授權同範圍規劃、Issue／PR、修復、push、merge 與已交付資源清理，不逐階段詢問。未決重大產品取捨、未授權發布、不可恢復的資料丟棄或必要憑證仍須處理。
- 以現有 CI／package scripts 驗證受影響範圍；保留 required checks、適用的 acceptance-map 與 coverage。相同 head/base 的有效結果不重跑。文件／規則改動不跑無關產品測試。
- commit／push 不觸發發布。Native、app config、plugins、native dependencies 變更需相容 binary；OTA／build／submit 僅按明確指定的平台與 channel 執行。
- 合併後驗證 remote SHA，移除已交付且無 active owner 的 task worktree、feature branch 與已核實的暫存／備份。先檢查 tracked、untracked、ignored、stash；Issue closed 不等於所有本地內容都可刪。
- 僅本次已授權整理範圍內的未交付內容關聯 GitHub recovery Issue／專用 worktree；無關 WIP 原位保留。正式文件、測試、憑證與發布資產不視作任務垃圾。
- 交付與清理各自回報；清理未完成繼續處理，不重啟已完成實作。不可把 Jest／typecheck 或 build 成功當成 native 裝置驗收。
