# 01 — 正規化並呈現組織者例外

**What to build:** 將既有成員、導航、定位、權限、離線與抵達事件收斂成可排序、去重、可結案的 Leader exception list。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 支援 late、needs_help、straggler、location_disabled、sharing_disabled、offline、force_quit_suspected。
- [x] 每筆包含 member、目前集合點、root-cause key、first／last seen、severity 與 handling status。
- [x] 同一 member／session／root cause 只呈現一筆可更新項目。
- [x] 預設依 severity 與 freshness 排序。
- [x] Leader 可將項目標記 acknowledged 或 resolved。
- [x] 正常 travel mode、ETA 與 progress 不出現在清單。
