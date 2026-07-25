# 01 — 全隊集合點狀態機與兩個操作

**What to build:** 讓全隊以同一個 authoritative state 呈現目前集合點，並只提供 Start 與 End 兩個可按操作；Start 後的「前往中」只能顯示，不能再次按下。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 初始與結束後都是 global `staying`，且沒有集合點處於 `en_route`。
- [x] pending 點只顯示可按的「開始」。
- [x] Start 後 point 為 `en_route`、global 為 `en_route`，Start disabled、End enabled。
- [x] End 後 point 為 `completed`、global 回到 `staying`，下一點保持 pending。
- [x] invalid、duplicate、stale-version transition 會被拒絕或收斂為一個結果。
- [x] map、播報、notification、被動模式使用同一份 team state。
