# 11 — Push 遠端 master 並證明交付收斂

**What to build:** 將已驗證的本地 master 推送到遠端，核對實際遠端 SHA，並以清冊與 Git 狀態證明沒有未提交、未追蹤或未處理 WIP。

**Blocked by:** 10

**Status:** in-progress at ship time

- [ ] push 前再次確認目前分支為 master、upstream 正確、local master 包含核准 merge commit，且沒有未知 staged／unstaged changes。
- [ ] push 的目標是遠端 master，不以只 push 私有分支代替。
- [ ] push 後 fetch／查詢遠端，證明 local master SHA、remote-tracking master SHA 與實際遠端 master SHA 一致。
- [x] 最終 WIP manifest 每一項都有整合 commit、排除紀錄或獨立移轉落點，兩個原 local commits 也有可追溯落點。
- [ ] `git status` 沒有未提交或未追蹤項目；若保留任何獨立專案工作，必須位於正確邊界並有單獨狀態證據，不得留在 Mobile repo 成為無主 WIP。
- [x] 最終報告列出整合內容、排除／移轉內容、測試與 gate 狀態、task-scoped commit SHA、merge SHA、remote master SHA 及外部限制。
- [x] 未執行的 Supabase deploy、native build、OTA、TestFlight、App Store submit 與實機驗證保持 Unverified／Blocked，不因 Git push 改標 Passed（db push 另記錄）。
- [ ] 若任何 SHA 不一致、工作樹不乾淨或清冊未收斂，任務不得標示完成。
