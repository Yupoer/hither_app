# Onboarding 重新設計 Brief

> 給 Claude Code 的交接文件：現有 Onboarding 流程/內容架構 + 重新設計時需要決定的事項。
> 程式碼位置：`apps/mobile/src/onboarding/`

## 1. 現有架構（不建議動，除非要重構）

三層分離，重新設計畫面時**只需換 UI 層**，邏輯層不用動：

- `flow.ts` — 純狀態機，決定 `nextStep`/`prevStep`
- `content.ts` — 純資料（選項、測驗題、寵物對照表），文案本身在 `i18n/index.ts` 的 `onboarding.*` key
- `steps/*.tsx` + `OnboardingScreen.tsx` — UI 層，`STEP_RENDERERS` 把 `StepId` 對應到畫面元件
- `steps/StepShell.tsx` — 每個畫面共用的外殼：返回箭頭、進度小圓點（`ProgressDots.tsx`）、跳過連結、標題、內容區、底部 CTA

## 2. 完整流程圖

```
intro → theme → role
                  ├─ leader（牧羊人/隊長）:  L1_purpose → L2_days → L3_departure ─┐
                  ├─ follower（羊群/隊員）:  F1 → F2 → F3 → mascot → F4_prefs ───┤
                  └─ browser（先逛逛）:      C1_why → C2_companions → C3_wanted ─┘
                                                                                  ↓
                                                                            celebration → done
```

- 每畫面都可以「返回」或「跳過整個流程」（跳過會直接標記 onboarding 完成）
- `mascot` 是根據 F1-F3 三題 A/B 答案運算出的結果畫面，不可返回重答，返回鍵會直接跳過 `mascot` 回到 `F3`

## 3. 各畫面現有內容

| Step | 標題（中文現況） | 內容型態 | 選項 |
|---|---|---|---|
| intro | 牽起隊伍，不再走散 | 說明 + CTA「開始」 | — |
| theme | 選一個喜歡的主題 | 單選 | 夜燈／晨光／暮色／森林 |
| role | 你是哪一種旅人？ | 單選（決定分支） | 牧羊人(leader)／羊群(follower)／我只是先下載看看(browser) |
| L1_purpose | 這趟旅行的目的是？ | 單選 2x2 | 出國旅行／城市探索／家庭出遊／朋友聚會 |
| L2_days | 這趟旅行大概幾天？ | 滑桿數字（1-14天） | — |
| L3_departure | 什麼時候出發？ | 單選/日期 | 我現在就要用／距出發還有 N 天 |
| F1/F2/F3 | 三題情境題（自由活動/陌生城市/集合時間） | A/B 二選一 | 各題兩個選項 |
| mascot | （運算結果，無獨立標題） | 結果展示（emoji 佔位，尚無美術） | 邊境牧羊犬／黃金獵犬／無尾熊／貓，各配一句描述+「最搭 XX 型隊長」 |
| F4_prefs | 你喜歡什麼樣的景點？ | 多選 | 美食／景點／購物／自然／文化／夜生活 |
| C1_why | 你為什麼想用 Hither？ | 單選 | 找人／怕走丟／規劃行程／好奇 |
| C2_companions | 通常和誰一起旅行？ | 單選 | 家人／朋友／伴侶／同事 |
| C3_wanted | 你最想要哪個功能？ | 單選 | 即時定位／集合提醒／行程共編／旅程回顧 |
| celebration | 一切就緒！ | 說明 + CTA「出發」 | — |

完整雙語文案在 `apps/mobile/src/i18n/index.ts` 搜尋 `onboarding.`。

## 4. 現有共用視覺元素（StepShell）

- 頂部：返回箭頭（左）／跳過連結（右）
- 進度：N 個小圓點，當前題放大並套用 accent 色
- 標題：單行大字
- 內容區：可捲動
- 底部：可選 CTA footer

主題色（`theme.ts` / `PreferencesContext`）已支援夜燈/晨光/暮色/森林四套配色，畫面重繪時要吃這套 token，不要寫死顏色。

## 5. 重新設計時要決定的事項（帶著這幾題去跟 Claude Code 討論）

參考行為心理學檢查表，對照現況列出的觀察點：

1. **進度感（Goal-Gradient）**：目前圓點從 intro 就開始算、index 從 0 開始。要不要讓使用者一進來就「已經有進度」（例如把 intro 不算進度條，或第一個問題就顯示成第 2/N 步）？
2. **智慧預設（Smart Defaults）**：L2_days 滑桿、L3_departure 目前預設值是什麼？能不能依裝置語系/地區猜一個更合理的預設，讓使用者「調整」而不是「從零選」？
3. **IKEA/沉沒成本效應**：現況已經用「先選主題→測驗→算出寵物人格」的方式讓使用者投入，這段要保留還是簡化？寵物人格目前只有 emoji 佔位、無美術，是否要在這波重繪一併補上插畫？
4. **互惠（Reciprocity）**：intro 目前已經先說明價值再問問題，這點維持即可；不要在使用者還沒感受到價值前就要求登入/填資料（目前流程本來就沒有登入牆，維持）。
5. **三分支要不要合併/簡化**：leader/follower/browser 三條分支目前長度不一（3~5 步），重繪時要不要拉齊步數或乾脆縮短最長的 follower 分支（F1→F2→F3→mascot→F4_prefs 共 5 步）？
6. **跳過行為**：目前「跳過」是整個流程直接跳到完成，不會補問；重繪後這個行為要不要變（例如跳過只跳到 role，之後不再问)？
7. **視覺方向**：要沿用現有「牧羊人/羊群」主題敘事，還是要換一套視覺隱喻？（Baseline 規則：改動畫面結構前需使用者同意，見 `CLAUDE.md`）

## 6. 給 Claude Code 的邊界提醒

- UI baseline 未經同意不可大改畫面結構（見 `CLAUDE.md` 工作規則 #7）
- 只換 `steps/*.tsx` + `StepShell.tsx`／`ProgressDots.tsx`，不要動 `flow.ts`／`content.ts`／`OnboardingScreen.tsx` 的狀態機邏輯，除非重新設計真的需要改變步驟順序或新增/刪減步驟
- 完成定義：`npm test && npm run typecheck` 通過 **且** 在 Expo Go 實機跑過整個流程（三個分支都要各走一次）
