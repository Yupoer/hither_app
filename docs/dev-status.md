# Hither App — 開發現況報告（給 Claude Design 對齊用）

| 欄位 | 內容 |
|------|------|
| 報告日期 | 2026-07-01 |
| 對應程式碼 | `hither_app` master @ `0953288`（2026-06-20） |
| 對應 PRD | `hither_app/docs/MVP.md`（v0.1.0，Draft，2026-06-16，**已過期，見第 5 節**） |
| 驗證方式 | 直接讀原始碼、`git log`、Supabase MCP `list_tables` + Explore agent 交叉核對（非猜測） |

---

## 1. 一句話現況

Route A 架構(React Native 為唯一業務邏輯核心、原生只包裝置能力、後端 Supabase)已完整落地,且 Supabase 上有真實測試資料在跑(`groups` 34 筆、`memberships` 35 筆)。核心集合場景、多集合點動態導覽、推播與 Live Activity 都是真功能,`src` 內找不到任何 TODO/stub/mock 標記。

---

## 2. 技術棧與 RN／原生混合模式邊界

- **Expo SDK 54 / React Native 0.81.5 / React 19 / TypeScript**,已啟用 **Hermes + New Architecture**(commit `1746dbe`)。
- **業務邏輯 100% 在 RN JS 層**;原生只做裝置能力封裝,唯一入口是 `apps/mobile/src/native/`:`location.ts`、`maps.ts`、`notifications.ts`、`liveActivity.ts`、`liquidGlass.tsx`。UI 元件禁止直接判斷 `Platform.OS`,平台差異一律下沉到這層。
- 每個入口都用 `requireOptionalNativeModule('Hither...')` 偵測原生模組是否存在(EAS Dev Build):
  - `modules/hither-location`(Swift):**只有 scaffold**,`getCurrentLocation` 直接回 `nil` 並留 `TODO(Phase B)`;JS 端目前**永遠 fallback 用 `expo-location`**。
  - `modules/hither-maps`(Swift, MapKit):**已完整實作**(`MKLocalSearch`/`MKDirections`),無原生模組時 fallback 成 Nominatim(OSM)。
  - `modules/hither-notifications`(Swift):**刻意留空**(註解說明 `expo-notifications` 已接管 APNs token,不需要原生模組)。
  - `modules/hither-live-activity`(Swift):**已完整實作** ActivityKit start/update/end,串接 iOS Widget Extension(`apps/mobile/targets/live-activity/`,由 `@bacons/apple-targets` 產生),已確認連進 `ios/Podfile.lock`(真的有編譯進去,不是放著沒用)。
- **這條 Live Activity/Widget 路徑 Expo Go 跑不了**,需要 EAS Dev Build 或實機編譯——這是 MVP.md 原本「純 Expo Go 驗收」假設之外新增的落差,設計端要知道這部分只能上 Dev Build 展示。
- 舊 SwiftUI 原生 App(`ios_native/`)已整個移除,沒有任何舊 Swift 程式碼被連結進現在的 RN App,純粹是參考:`docs/legacy-ios-reference.md`、`apps/mobile/docs/ios-native-salvage.md`(commit `9f835bf`)。

## 3. 後端現況(Supabase,非 PRD 寫的「Node.js 待定」)

- Project `htqrucnjafhhvxdqslbv`,**8 張表全開 RLS**:`profiles` / `groups` / `memberships` / `itinerary_items` / `member_locations`(Phase S 原始 5 張)+ `notification_preferences` / `push_tokens` / `commands`(推播功能新增)。
- 目前有真實資料:`profiles` 19 筆、`groups` 34 筆、`memberships` 35 筆、`commands` 11 筆 → 代表 Supabase 匿名登入已在 Dashboard 開啟,且已跑過真機/多裝置驗證。
- 認證:`signInAnonymously()`(`src/state/SessionContext.tsx`),**非** PRD 寫的「裝置本地 token」。
- `src/api/client.ts`(564 行):`createGroup`/`joinGroup`(走 `join_group` RPC)/`getGroupState`/`updateNextDestination`/`addDestination`/`reorderDestinations`/`updateNickname`/`updateMyLocation`/`savePushToken`/`sendCommand`/通知偏好/`setJourneyStatus` 全部是真實 Supabase 呼叫,無 TODO/stub。
- Realtime:`useGroupState.ts` 訂閱 `member_locations`/`memberships`/`itinerary_items` 的 `postgres_changes`,debounce 後 refetch,另加 15 秒輪詢當保險。
- 狀態管理:純 React Context + hooks(`SessionContext`/`PreferencesContext`/`useGroupState`/`useLiveActivity`/`useGroupNotifications`/`usePushRegistration`),沒有 Redux/Zustand。

## 4. 已完成功能(對照 MVP.md 章節)

- **Auth**(對應 §3.2/3.3):單一 `AuthScreen`,輸入暱稱(+ 可留白的 email 欄位,目前未使用)→ 匿名登入 → 已有 session 就直接跳過重登。
- **Group / 角色**(對應 §2):`GroupScreen` 身兼「角色選擇＋建立/加入＋Lobby」一頁,建立時 `role=leader`、加入時 `role=follower`。**PRD/設計稿原本是獨立的角色選擇畫面,現在合併成一頁**。
- **地圖 / 即時位置**(對應 §3.4):`GroupMap`(含 web fallback `GroupMap.web.tsx`)顯示所有成員 pin。
- **多集合點動態導覽**(超出 PRD 範圍):不再是 PRD §1.3「同時只有一個 active gathering point」,而是可拖曳重排、append-to-end 的多站行程(`DestinationReorderList`),地圖底部卡片變成**可左右滑動的 carousel**,滑到哪一站,地圖鏡頭與燈籠 marker 就跟到哪一站(commit `c6e94db`、`bb4a12e`)。原本 §3.5 的「長按地圖設集合點」也被取代成搜尋+加入行程(`DestinationSearch`)。**這是主動的範疇擴張,PRD 需要更新以反映「多集合點」取代「單一集合點」**。
- **Leader Journey / Live Activity**(PRD §3.7 原本標 `MVP+`,現已提前做且完整):`JourneyBanner` 在 App 內鏡射 iOS Live Activity/動態島狀態(距離、ETA、journey 狀態),`useLiveActivity` 驅動原生 ActivityKit start/update/end。
- **推播通知**(PRD §5.4 標「MVP 不啟用」,現已提前做且完整):APNs 推播(`send-push` Edge Function 扇出)、`push_tokens`/`notification_preferences` 資料層、per-category 通知開關、`QuickCommandsCard`(leader 下指令、follower 回報需求)。
- **Settings**(PRD 沒有這個畫面):語言 zh/en、主題 night/day/dusk(存 AsyncStorage)、暱稱編輯、group 資訊。
- **Debug 工具**(PRD 未提及,內部用):隱藏開發者選單可疊加假成員(`enableDebugMembers`),方便單人測試多成員地圖。

> **待確認**:使用者說的「動態導覽」,程式碼裡最符合的是上面的 **Leader Journey / Live Activity** 這組(即時距離/ETA 隨移動更新,含鎖定畫面動態島)。程式碼裡**沒有**任何 App 內導覽教學/onboarding tour 元件(已用 tour/onboarding/walkthrough/coachmark/導覽/教學 等關鍵字掃過 `src` 和 commit 訊息,皆無結果)。如果指的是後者,目前還沒做,需要另外排入計畫。

## 5. 與 PRD/設計稿的已知落差(需要對齊)

1. **身份模型**:MVP.md 仍寫「不需 email/密碼」「裝置本地 token」;實作是 Supabase 匿名登入 + 可選 email 欄位。這個決策先前已拍板改過,但 **MVP.md 文件本身沒更新**。
2. **後端技術**:MVP.md §7 open question 寫「後端語言待定,假設 Node.js」;實際上早已拍板 Supabase,**這題可以直接關閉**。
3. **集合點模型(最大範疇變化)**:MVP.md §1.3「單一進行中集合點」+ §3.5「長按地圖設點」已被目前的多站/可重排/搜尋加入行程取代。
4. **畫面數**:PRD/設計稿是 6 畫面(角色選擇/建立/加入/Lobby/地圖/指令 sheet);實作是 **4 個 screen**(Auth/Group/Map/Settings)——角色選擇併入 Group,指令 sheet 併入 Settings 的 `QuickCommandsCard`,Settings 整體是新增畫面。
5. **驗收方式**:PRD 寫「Expo Go 驗證」;但 Live Activity/Widget/`hither-maps`/`hither-live-activity` 原生模組需要 Dev Build,Expo Go 只能測純 JS 路徑(含 `hither-location` 目前也只能走 JS fallback)。
6. **推播與 Live Activity 進度超前**:PRD 把這兩項標 `MVP+`/不啟用,實際上已經做完整套資料層+UI+原生 ActivityKit,比 PRD 假設的進度快。

## 6. 尚未做／已知缺口

- **背景/高精度定位**:`hither-location` 原生模組只是留空的 scaffold(`TODO(Phase B)`),目前只有前景 `expo-location` 在運作,PRD §5.3 的「背景 30 秒更新」還沒實作。
- **Android**:`modules/hither-*/android/` 只有 placeholder gradle,未實作也未實測(PRD 本就列為 `MVP+`)。
- **App 內導覽教學/Onboarding tour**:如第 4 節「待確認」所述,目前完全沒有這個功能,需要跟使用者確認這是否是他所指的「動態導覽」。
- QR code 加入、Group 歷史記錄、帳號系統、路線規劃 API:皆未實作,符合 PRD §6 Out of Scope/`MVP+` 範疇,非缺口。

## 7. 關鍵 commit 索引

| Commit | 內容 |
|--------|------|
| `a1c6e66` → `3173560` | Phase 4→A:MVP 垂直切片、`src/native` 裝置能力邊界 |
| `8d778af` / `906367d` | Phase B/C:原生模組 scaffold、Liquid Glass |
| `6b9d10a`…`2611dfc` | Phase S:Supabase schema/RLS/認證/RN 資料層,修 RLS 缺陷 |
| `9f835bf` | 移除舊 `ios_native`,抽取 `legacy-ios-reference.md` |
| `c6e94db`/`bb4a12e` | 多集合點 carousel + 拖曳重排(動態導覽候選功能) |
| `971f35e`…`0953288` | 推播、Quick Commands、Leader Journey、Live Activity Widget |

## 附錄:關鍵檔案路徑

- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/screens/{AuthScreen,GroupScreen,MapScreen,SettingsScreen}.tsx`
- `apps/mobile/src/native/{index,location,maps,notifications,liveActivity,liquidGlass}.ts`
- `apps/mobile/src/api/{supabase,client}.ts`
- `apps/mobile/src/state/*`
- `apps/mobile/src/components/{JourneyBanner,QuickCommandsCard,DestinationSearch,DestinationReorderList,GroupMap}.tsx`
- `apps/mobile/modules/hither-{location,maps,notifications,live-activity}/ios/*.swift`
- `apps/mobile/targets/live-activity/*`
- `docs/legacy-ios-reference.md`、`apps/mobile/docs/ios-native-salvage.md`
- `docs/MVP.md`、`docs/apns-live-activity-setup.md`
