# Hither UI、導航、歷史與耗能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正集合點 UI/導航權限/歷史權限/首頁首屏，並消除已量測的查詢風暴與定位顯示耗能。

**Architecture:** 沿用現有 MapScreen、navigation session、Realtime、SQLite outbox 與 react-native-maps。權限由 Supabase RLS 保證，client 只呈現被授權資料；效能先修 effect identity 根因，再用 native marker animation 與本地快取改善視覺。

**Tech Stack:** Expo SDK 54、React Native 0.81、Reanimated 4、react-native-maps、AsyncStorage、Supabase PostgreSQL/RLS/Jest。

## Global Constraints

- 不新增 dependency、不更動 native module/package/app config。
- 不降低既有定位採樣精度；顯示補間不得外推超過最新實際座標。
- 保留使用者既有 `scripts/task-end-ship.sh` 修改，不納入 commit。
- 所有行為變更先有失敗測試，再做最小實作。

---

### Task 1: 查詢風暴與上傳節流

**Files:**
- Modify: `apps/mobile/src/i18n/index.ts`
- Modify: `apps/mobile/src/screens/MapScreen/hooks/useDeviceLocation.ts`
- Test: `apps/mobile/src/__tests__/performanceRegression.test.tsx`

**Interfaces:**
- Produces stable `useTranslation(): Translator` identity per language.
- Produces one scheduled outbox flush for burst enqueues.

- [ ] 寫測試：同語言 rerender 時 `t` identity 不變；位置 burst 不產生逐點 flush。
- [ ] 跑測試並確認因現有 identity/flush 行為而失敗。
- [ ] 用 `useMemo` 固定 translator；用 ref + timeout 合併 foreground flush。
- [ ] 跑 targeted tests 確認通過。

### Task 2: 卡片、導航與首頁動畫

**Files:**
- Create: `apps/mobile/src/components/OverflowMarquee.tsx`
- Modify: `apps/mobile/src/screens/MapScreen.tsx`
- Modify: `apps/mobile/src/i18n/index.ts`
- Modify: `apps/mobile/src/screens/RoleSelectScreen.tsx`
- Test: `apps/mobile/src/__tests__/mapUiContracts.test.ts`

**Interfaces:**
- `OverflowMarquee` renders a single-line title and animates only when measured text exceeds its viewport.
- Follower route button states: plan, close plan, navigation active disabled.

- [ ] 寫 static/behavior contract，要求 marquee、2 秒端點停留、隊長/隊員 label/disabled、抵達可取消、固定 create/join 與 My Teams FadeIn。
- [ ] 跑測試確認失敗。
- [ ] 加最小 component 與 MapScreen/RoleSelect 修改，壓縮既有 style 間距。
- [ ] 跑 UI contract 與 typecheck。

### Task 3: 頭像持久快取

**Files:**
- Modify: `apps/mobile/src/api/services/GroupService.ts`
- Modify: `apps/mobile/src/screens/RoleSelectScreen.tsx`
- Test: `apps/mobile/src/__tests__/joinedGroupsCache.test.ts`

**Interfaces:**
- Persistent key `@hither/joined-group-avatars:<user-id>` stores only group avatar/color arrays.
- Lite group fetch merges cached avatars; full fetch refreshes cache.

- [ ] 寫 cache read/merge/write 測試並確認失敗。
- [ ] 用既有 AsyncStorage 實作使用者隔離 cache，忽略損壞 JSON。
- [ ] 讓 RoleSelect background lite fetch 先合併 persistent avatars。
- [ ] 跑 targeted tests。

### Task 4: Marker 插值與歷史 RLS

**Files:**
- Modify: `apps/mobile/src/components/GroupMap.tsx`
- Create: `supabase/migrations/20260717190000_history_visibility.sql`
- Modify: `supabase/tests/team_navigation_sessions.test.sql` or add contract test under mobile.
- Test: `apps/mobile/src/__tests__/mapUiContracts.test.ts`
- Test: `apps/mobile/src/__tests__/gatheringWorkflowContract.test.ts`

**Interfaces:**
- `MemberMarker` uses native `AnimatedRegion` and `Marker.Animated` without coordinate extrapolation.
- RLS: own rows OR current leader of row group.

- [ ] 寫 Marker/RLS contract 測試並確認失敗。
- [ ] 實作 native marker interpolation。
- [ ] 新增 migration，drop 舊 group-member select policy，建立 own-or-leader policy。
- [ ] 跑 tests、apply migration、再跑 Supabase advisors。

### Task 5: 全面驗證與交付

**Files:** 所有本次明確變更；不包含 `scripts/task-end-ship.sh`。

- [ ] 跑 targeted tests、`npm test -- --runInBand`、`npm run typecheck`、`npm run lint`。
- [ ] 檢查 git diff 與 OTA eligibility，明確 stage 本次檔案並 commit。
- [ ] push feature branch、merge master、publish production + preview OTA。
- [ ] 記錄 commit SHA、master SHA、OTA update group/runtime/dashboard link。

