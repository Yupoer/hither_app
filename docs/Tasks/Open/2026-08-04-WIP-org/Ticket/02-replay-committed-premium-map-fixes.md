# 02 — 將已提交 Premium／Map 修正重播到最新 master

**What to build:** 以 Ticket 01 鎖定的主線為基礎，逐一整合 `0992a6e` 與 `9aa6660` 所代表的 review-fix 行為，保留最新 master 的設定與功能，並為每個衝突留下可審查判斷。

**Blocked by:** 01 — 鎖定最新 master 並建立完整 WIP 清冊。

**Status:** ready-for-agent

- [ ] 兩個 commit 依歷史順序逐一重播，不直接整批 merge 舊工作分支。
- [ ] 每個衝突都以最新 master 語意為基準解決，並記錄保留、改寫或排除的理由。
- [ ] Premium notification ledger、StoreKit fail-closed、trial eligibility、projection、Realtime race、native map boundary 與 route LOD 行為均能在整合後辨識。
- [ ] Expo Dev Client、preview、package lock、Expo dependencies、runtimeVersion 0.1.5 與 App Store 設定沒有無理由回退。
- [ ] 執行兩個 commit 對應的 focused tests、typecheck 與 diff check；Deno、SQL、native 與視覺 runtime 未執行時標成 Unverified。
- [ ] 清冊中的兩個 local commits 各自指向新的落點 commit 或明確排除紀錄。

