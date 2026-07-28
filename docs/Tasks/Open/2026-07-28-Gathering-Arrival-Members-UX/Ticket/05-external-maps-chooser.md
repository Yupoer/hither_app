# 05 — 集合點外部地圖改為 Google／Apple 選擇後開啟

**What to build:** 集合點卡片外部地圖按鈕先讓使用者選 Google Maps 或 Apple Maps，再依選擇開啟對應地圖 App 導向該集合點（帶現行 travel mode 若支援）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 按下外部地圖控制先出現 Google Maps／Apple Maps（與取消）選項。
- [ ] 選擇後開啟對應 provider URL／scheme，不再只依 Platform 固定一種且不詢問。
- [ ] 取消不開啟任何外部 App。
- [ ] 無法開啟時有既有 Linking 失敗／fallback 行為，不崩潰。
- [ ] URL builder／chooser contract 覆蓋兩種 provider。
