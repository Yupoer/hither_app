# 07 — 加入集合點專屬 Emoji 與顏色

**What to build:** 行程編輯者可在調整集合點順序頁，為每一天的每個集合點設定專屬 Emoji 與顏色；選擇會跨資料庫、同步與裝置保存，舊資料則使用穩定 fallback。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 每個 itinerary item 可獨立保存 nullable Emoji 與 palette color；每日 header 顏色保留原用途。
- [ ] 建立、讀取、更新、Realtime、local snapshot、outbox 及所有目的地 projection 都保留新欄位。
- [ ] 既有集合點沒有新欄位時仍正常顯示，並使用穩定預設，不要求資料回填才能開啟行程。
- [ ] 編輯順序頁可對任一可編輯集合點開啟 picker，從 Spec 定義的 26 組 Emoji／顏色組合中選擇。
- [ ] 使用者可透過系統鍵盤輸入一個標準 Unicode Emoji grapheme sequence；variation selector、膚色、旗幟、keycap 與合法 ZWJ 組合可被接受。
- [ ] 一般文字、多個 Emoji、URL、圖片、貼圖、自訂字型內容、超長字串及不在 palette 的顏色會在 trust boundary 被拒絕。
- [ ] 舊 OS 無法顯示 glyph 時使用 fallback，不破壞同步資料，也不承諾不同平台圖樣相同。
- [ ] 不新增 Emoji library；若目標 Hermes 缺少必要 Unicode 能力，須以測試證明後才採用最小 fallback。
- [ ] 隊長／有編輯權限者可更新；其他成員只能讀取，不能跨 group 或越權更新。
- [ ] 測試涵蓋舊資料 fallback、每個集合點獨立值、跨 client 同步、權限、合法 Emoji sequence、非法輸入及 map／Live Activity 顯示。
