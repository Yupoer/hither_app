# 07 — Supabase、AdMob 與 Native 整合驗收

**What to build:** 將已完成的商店、Rewarded Ads、token 與權益整合到 linked Hither Supabase／AdMob 環境，完成兩平台 release-like 驗證並留下可區分程式完成、後端部署與 native 發布狀態的證據。

**Blocked by:** 03 — AdMob Native Rewarded Ad 流程；04 — Premium 一／三／七日卡兌換；05 — 額外集合點消耗額度；06 — 即時動態付費權益

**Status:** ready-for-agent

- [ ] 所有 schema changes 先通過 SQL／RLS／advisor 檢查，再以可追蹤 migration 部署到 linked Hither project。
- [ ] `admob-reward-callback` Edge Function 部署到 linked project，公開 callback URL 可達且只接受有效 Google SSV。
- [ ] iOS 與 Android Rewarded Ad Unit 的 SSV 設定使用同一 callback URL，並確認 reward 為 `1 hither_token`、未啟用 frequency cap。
- [ ] AdMob native config 使用核定的兩平台 App ID；正式 ad unit 不出現在一般自動測試或非 release-like 開發流程。
- [ ] AdMob Privacy & messaging／UMP consent 設定完成；付款、身分、兒童導向聲明與 app readiness 由帳號持有人確認並記錄為外部 gate。
- [ ] Android release-like build 驗證廣告 load/show/reward、Google SSV、wallet +1、商店刷新與至少一種商品兌換。
- [ ] iOS release-like build 在可用環境執行同等驗證；若缺少 Simulator／真機／簽章能力，明確保留為未驗證 gate，不以 Android 或 Jest 代替。
- [ ] 連續觀看多個廣告可逐筆入帳，沒有 Hither 每日／24 小時限制；同 transaction 重送仍不重複入帳。
- [ ] 端到端驗證 Premium 日卡、額外集合點與個人即時動態的 server restore，且不暴露 service-role 或 callback 敏感資料。
- [ ] 全套 Jest、TypeScript typecheck、focused SQL／Edge Function tests 與 `git diff --check` 通過；baseline failure 與本功能 regression 分開記錄。
- [ ] 更新產品決策，明載本 Spec 取代舊 OTA-08 對 token／Rewarded Ads 的 out-of-scope 決策，但不修改歷史 Spec。
- [ ] Report 分別列出 code、Supabase migration、Edge Function、AdMob console、Android native、iOS native、OTA／Build 狀態；未取得證據的項目不得宣稱完成。
