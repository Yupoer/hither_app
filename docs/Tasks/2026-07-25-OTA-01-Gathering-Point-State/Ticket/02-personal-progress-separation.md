# 02 — 分離個人進度與全隊狀態

**What to build:** 讓每位成員的 travel mode、粗略 ETA、位置、抵達與 progress 獨立顯示，並證明這些資訊不會改變全隊集合點的 phase 或 point status。

**Blocked by:** 01 — 全隊集合點狀態機與兩個操作

**Status:** done

- [x] 每位成員可擁有不同 travel mode、ETA、位置與抵達狀態。
- [x] 個人 progress 可更新而不觸發 team phase transition。
- [x] 個人 ETA 只作為粗略提示，不成為集合點完成判定。
- [x] 全隊 surfaces 疊加個人資訊時不改寫 team state。
- [x] personal/team state separation contract 測試通過。
