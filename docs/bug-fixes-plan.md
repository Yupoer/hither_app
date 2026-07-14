# Hither Bug Fix Mega-Plan

全面修復 ~20 個 bug，涵蓋字體縮放、主題一致性、團隊管理、通知推送、Dynamic Island 等領域。

---

## 進度追蹤（其他 session 接力用）

> 更新規則：動手前記 in_progress；
pm test + 
pm run typecheck 通過且 commit 上 master 後記 done；原生未實機驗證記 done-code + 備註。

| ID | Status | Branch / worktree | Commit | Notes |
|----|--------|-------------------|--------|-------|
| BUG-01 | done | fix/bug-01-04-font-theme | 2dbe1cb | maxFontSizeMultiplier=1 |
| BUG-02 | done | fix/bug-01-04-font-theme | 2dbe1cb | same as 01 |
| BUG-03 | done | fix/bug-01-04-font-theme | 2dbe1cb | same as 01 |
| BUG-04 | done | fix/bug-01-04-font-theme | 2dbe1cb | userInterfaceStyle dark + keyboardAppearance |
| BUG-05 | pending | | | LA emoji + progress % |
| BUG-06 | pending | | | nav haptics |
| BUG-07 | done | fix/bug-07-11-12-16-22-teams | 5b72f20 | show inviteCode on cards |
| BUG-08 | pending | | | avatar sync on login |
| BUG-09 | pending | | | peek vs stage1 recenter |
| BUG-10 | done | fix/bug-10-18-24-glass-ui | aac0f56 | transparent sheet/card borders |
| BUG-11 | done | fix/bug-07-11-12-16-22-teams | 5b72f20 | main filter explicit |
| BUG-12 | done | fix/bug-07-11-12-16-22-teams | 5b72f20 | virtual 主團隊 block |
| BUG-13 | pending | | | leader nav force-follow |
| BUG-14 | pending | | | search → notify captain |
| BUG-15 | pending | | | KML → notify captain |
| BUG-16 | done | fix/bug-07-11-12-16-22-teams | 5b72f20 | canEditItinerary already correct |
| BUG-17 | pending | | | history group_id migration |
| BUG-18 | done | fix/bug-10-18-24-glass-ui | aac0f56 | splitActions gap/padding |
| BUG-19 | pending | | | Dynamic Island layout |
| BUG-20 | pending | | | multi travel-mode routes |
| BUG-21 | pending | | | APNs fan-out audit |
| BUG-22 | done | fix/bug-07-11-12-16-22-teams | 5b72f20 | poll sent invites while pending |
| BUG-23 | done | fix/bug-23-custom-cmd | b330303 | profile update upsert + error detail |
| BUG-24 | done | fix/bug-10-18-24-glass-ui | aac0f56 | pill 0.82 + hairlineSoft |

---

## Bug 規格總覽

| ID | 優先級 | 摘要 | 影響範圍 |
|----|--------|------|----------|
| BUG-01 | P1 | iPhone 系統大字體導致 Emoji 頭像大小不一、所有 Sheet 排版變形 | 全域 |
| BUG-02 | P1 | iPhone 系統大字體影響集合點卡片排版＋長按展開功能失效 | MapScreen 卡片 |
| BUG-03 | P1 | iPhone 系統大字體影響快捷指令格數、按鈕大小、字體變形 | QuickCommandsCard |
| BUG-04 | P1 | 未設定 iPhone 主題（淺/深色）時介面顏色不統一（如搜尋欄） | 全域主題 |
| BUG-05 | P2 | 換頭貼時未同步即時動態＋即時動態需顯示進度 % | Live Activity |
| BUG-06 | P2 | 導航按鈕缺少振動回饋 | MapScreen 導航 |
| BUG-07 | P2 | 「查看我的隊伍」未顯示每個隊伍的加入代碼 | MyTeamsScreen |
| BUG-08 | P2 | 剛註冊/登入時自身頭像與隊伍內顯示不一致 | SessionContext |
| BUG-09 | P2 | Sheet peek 與 stage1 階段定位按鈕應有差異 | BottomSheet + MapScreen |
| BUG-10 | P2 | 集合點卡片、搜尋欄、設定 Sheet 邊框有細微白線 | glass 邊框系統 |
| BUG-11 | P2 | 隊員加入小隊時主團隊集合點卡片不應消失 | MapScreen 篩選邏輯 |
| BUG-12 | P2 | 有小隊時主團隊區塊應顯示「主團隊」+ 人數 | SubgroupSection |
| BUG-13 | P2 | 隊長點擊導航應讓所有隊員也自動開啟導航 + 即時動態 | 導航廣播 |
| BUG-14 | P2 | 隊員搜尋地點應改為「通知隊長」而非直接加入 | DestinationSearch |
| BUG-15 | P2 | 隊員 Google Map 匯入應改為「通知隊長」 | KmlImportSheet |
| BUG-16 | P2 | 小隊內每人應有主團隊隊長級集合點編輯權限 | 權限邏輯 |
| BUG-17 | P2 | 歷史集合點應掛在團隊資料下，不屬於任何人 | API + DB |
| BUG-18 | P2 | 小隊加入請求欄按鈕與字間距太靠近 | 邀請 UI |
| BUG-19 | P1 | 動態島排版跑掉，需與即時動態一致 | HitherLiveActivity.swift |
| BUG-20 | P2 | 開始導航時應顯示所有交通工具路徑規劃 | useMapKitRoutes |
| BUG-21 | P2 | 快捷指令僅本機通知，團隊其他人不會跳通知 (需 APN) | notifications + Edge Function |
| BUG-22 | P2 | 建立小隊邀請他人接受後，仍顯示「邀請中等待接受」 | useSubgroupInvites |
| BUG-23 | P2 | 自訂快捷指令發布時顯示「儲存失敗」 | CustomQuickCommandSheet |
| BUG-24 | P2 | 淺色系統背景 + 隊員角色下，定位膠囊和小隊膠囊透明度太高 | glass tokens |

> 詳細實作規格與 phase 分析見 repo 歷史與 session plan。本檔進度表為 session 接力權威來源。
