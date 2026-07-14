# Spec：Dynamic Type 真適配 + Onboarding 主題選擇 / Intro 動畫重設計

| 欄位 | 內容 |
|------|------|
| 狀態 | Draft → Ready for implementation |
| 日期 | 2026-07-14 |
| 產品 | Hither (`apps/mobile`) |
| 相關 | BUG-01～03 的 `maxFontSizeMultiplier=1` **將被本 spec 取代** |
| 設計依據 | `docs/Hither Design System/`（north star、tokens、Onboarding kit） |
| UX 依據 | Goal-Gradient、Smart Defaults、IKEA/Endowment、Reciprocity（見 UX psychology skill） |
| 視覺依據 | Duolingo-fun × Apple-Maps-clean；Liquid Glass；Fredoka display |

---

## 1. 問題與目標

### 1.1 現況問題

1. **字體（BUG-01～03 的暫解）**  
   全域 `maxFontSizeMultiplier = 1` 讓排版穩定，但**完全無視** iOS「設定 → 顯示與亮度 → 文字大小」。視障／長輩使用者在系統開大字時，Hither 內文與系統其他 App 體感不一致，不符合真·無障礙預期。

2. **Onboarding 主題選擇（`ThemeStep`）**  
   四格實心 accent 色塊 + 白邊 selection ring，讀起來像廉價色票，不像 Design System 的 **Liquid Glass 預覽卡**（地圖色 + glass 材質 + crook／accent beacon）。與 map 上 glass chrome 的品質落差大。

3. **Onboarding Intro 動畫（`IntroStep`）**  
   中央小圓點 + 6 個灰點沿橢圓「散開／聚攏」循環。語意含糊、視覺廉價，且 DS motion 明確寫 **「No infinite decorative loops」**。UI kit 的 intro 是大 emoji hero + 牧羊隱喻文案，現況未對齊。

### 1.2 目標（Acceptance themes）

| ID | 目標 | 成功標準（摘要） |
|----|------|------------------|
| G1 | **真·Dynamic Type** | 系統字體從預設～最大，關鍵文字會放大；glass 排版不溢出、不互相遮擋、不擋 44pt 觸控 |
| G2 | **主題選擇像 Hither** | 四主題以「迷你地圖 + glass 預覽」呈現，選中態有 accent glow / crook 或 check，符合 DS card 語彙 |
| G3 | **Intro 有品牌敘事** | 首屏動畫表達「走散 → 集合」，有限次或可暫停的 choreography，對齊 crook / flock 隱喻 |
| G4 | **可維護** | 字體策略集中、有 accessibility 測試契約；onboarding 仍只動 UI 層（`flow.ts` / `content.ts` 邏輯不動） |

### 1.3 非目標

- 不做完整 WCAG AAA 全站 audit  
- 不改 onboarding 步驟順序／分支狀態機（除非實作時發現必須，另開 decision）  
- 不重做整包 map UI（本 spec 的 Dynamic Type 規則會覆蓋 map glass，但視覺改版以 onboarding 為先）  
- 不強制使用者開大字；只「跟隨系統」

---

## 2. 設計原則（必須遵守）

來自 **Hither Design System**：

1. **Duolingo-fun meets Apple-Maps-clean** — onboarding 可更 sticker / playful；map glass 維持冷靜可信。  
2. **Liquid Glass** — 浮層：blur 感（或 opaque fallback）、頂緣高光、specular sheen、**彩色 glow 選中**，禁止「白邊當質感」。  
3. **Fredoka** 用於 display／大數字；UI body 用系統／Jakarta 路線（RN 上用系統字 + Fredoka display）。  
4. **Motion**：tap 用 spring（`--ease-spring`、press scale 0.96）；sheet／surface 用 decel；**禁止無意義無限裝飾循環**。  
5. **44pt min tap**；spacing 4px 網格；radius card 24、pane 30–38、pill 全圓。

來自 **UX psychology**：

1. **Goal-Gradient** — intro 可算「已開始」的進度（進度條不要從空洞的 0 感開始）。  
2. **Smart Defaults** — 主題預設 `night`（品牌基準），一進來就有選中態，使用者是「確認／改選」不是從零開始。  
3. **IKEA / Endowment** — 主題選擇是早期 ownership 時刻：即時套用 `setThemeName`，後續 step 立刻吃到新 palette。  
4. **Reciprocity** — Intro 先用動畫＋一句價值主張「給到感覺」，再 CTA「開始」；不先要登入。

---

## 3. Spec A — Dynamic Type 真適配（取代 cap=1）

### 3.1 策略總覽：「分級縮放 + 彈性容器」

不再用全域 `maxFontSizeMultiplier = 1`。改為：

```
系統字級  →  RN Text 可縮放  →  版面依 category 彈性成長
                 ↑
         有上限的 multiplier + 固定尺寸的「圖示殼」
```

核心取捨：

| 內容類型 | 是否跟隨 Dynamic Type | 倍率上限（建議） | Layout 策略 |
|----------|----------------------|------------------|-------------|
| **Body / 列表標題 / Sheet 文案** | ✅ | **1.3** | 多行、`flexShrink`、行高隨字級、容器 `minHeight` 而非固定 height |
| **Display 標題（Fredoka 大標）** | ✅ 溫和 | **1.2** | `numberOfLines` + 可換行；大字時減少 letterSpacing |
| **Metric 數字（ETA、距離）** | ✅ 溫和 | **1.15** | 固定 min-width tabular；必要時字級 bucket 降一級 |
| **Emoji 頭像字形** | ❌（字級不跟） | **1.0** | **容器固定**（如 40×40），emoji 用固定 `fontSize` 或 `allowFontScaling={false}`，避免頭像大小不一 |
| **Icon-only 按鈕 / SF Symbol 圖示** | ❌ | n/a | 固定 19–22pt icon；hitSlop 補足 44pt |
| **Capsule 內短標籤**（角色 chip、導航按鈕文案） | ✅ 有限 | **1.15** | 優先單行 ellipsis；大字時改 **兩行 pill** 或 **icon-only + a11yLabel**（見 3.4） |
| **TextInput** | ✅ | **1.3** | `minHeight` 48→56 隨 bucket；padding 垂直加大 |

> 倍率是「相對於設計稿 fontSize 的上限」。在 iOS Accessibility 最大字級時，體感約在「明顯放大但仍可控」。

### 3.2 型別與 API（建議實作）

#### 3.2.1 移除 / 取代現有 cap

**刪除** `App.tsx` 內全域：

```ts
Text.defaultProps.maxFontSizeMultiplier = 1
TextInput.defaultProps.maxFontSizeMultiplier = 1
```

#### 3.2.2 新增 `src/theme/typeScale.ts`（或 `src/a11y/dynamicType.ts`）

```ts
export type TypeRole =
  | 'display'   // Fredoka titles
  | 'title'     // section / card titles
  | 'body'
  | 'callout'
  | 'footnote'
  | 'caption'
  | 'metric'    // ETA / distance numerals
  | 'emoji';    // avatar glyphs — no scaling

export const TYPE_MAX_MULTIPLIER: Record<TypeRole, number> = {
  display: 1.2,
  title: 1.25,
  body: 1.3,
  callout: 1.3,
  footnote: 1.25,
  caption: 1.2,
  metric: 1.15,
  emoji: 1.0,
};

/** Design-token base sizes (px) — aligned to DS typography.css */
export const TYPE_BASE: Record<TypeRole, number> = {
  display: 34, // --text-display-lg default; heroes may use 44
  title: 19,
  body: 16,
  callout: 15,
  footnote: 13,
  caption: 11,
  metric: 34,
  emoji: 16, // visual only; container owns layout
};
```

#### 3.2.3 元件：`HitherText` / `HitherTextInput`

```tsx
// 薄封裝，強制 role → maxFontSizeMultiplier + 預設 lineHeight
<HitherText role="body" style={...}>...</HitherText>
// emoji:
<HitherText role="emoji" allowFontScaling={false}>😎</HitherText>
```

**遷移規則**

| 階段 | 範圍 |
|------|------|
| Phase 1 | 共用 primitives：`StepShell`、`PrimaryButton`、`BottomSheet` 標題、`QuickCommandsCard` 標籤 |
| Phase 2 | Map glass：carousel card 文案、flock row、invite row |
| Phase 3 | 其餘 screens | 

**禁止** 在業務元件上到處手寫不同 multiplier；一律走 `role`。

### 3.3 Layout 適配規則（大字時「重設計」而非硬撐）

當偵測到系統字級偏大時（見 3.5 buckets），下列元件 **切換 layout variant**：

#### 3.3.1 集合點卡片 command row（現況最易炸）

| Bucket | Layout |
|--------|--------|
| `regular` | 單列：導航 · 交通 · Apple Maps · 集合時間（現況） |
| `large` | **兩列**：第一列導航（full-width 高按鈕）；第二列三等分 icon pills |
| `xl` | 導航 full-width；次要動作收入「⋯」menu 或只留 icon + accessibilityLabel |

#### 3.3.2 快捷指令網格（QuickCommandsCard）

| Bucket | Layout |
|--------|--------|
| `regular` | 4 欄（或現況欄數） |
| `large` | **3 欄**，格子 `minHeight` 提高 |
| `xl` | **2 欄**，標籤最多 2 行 |

#### 3.3.3 Emoji / Avatar

- **外殼尺寸固定**（token：`avatar.sm=32` `md=40` `lg=48`），不隨字級長高。  
- 內部 emoji：`allowFontScaling={false}` + 固定 fontSize（約殼的 50–55%）。  
- 如此系統大字時「文字變大、頭像一致」——符合社群頭像慣例，也避免 BUG-01 復發。

#### 3.3.4 Sheet / list rows

- 禁用固定 `height: 48` 當唯一高度；改 `minHeight: 48` + `paddingVertical: 12`。  
- 主標 + 副標改 column stack；大字時允許副標換行。  
- Invite 列（已放寬 gap）在 `large+` 改 **垂直 stack**：文案 full width → 下方 accept/decline 並排。

#### 3.3.5 浮動 pills（group pill、recenter）

- Group pill：大字時隱藏次要數字「· N」，只留名稱 ellipsis；或改成兩行（名稱 / 人數）。  
- Recenter：維持 icon-only（本來就無文字），不受字級影響。

### 3.4 Accessibility 測試契約

新增 `src/__tests__/dynamicTypeContract.test.ts`（純靜態／契約）：

- `TYPE_MAX_MULTIPLIER.emoji === 1`  
- 禁止業務路徑再設全域 `maxFontSizeMultiplier = 1`（grep App.tsx 為 fail）  
- MapScreen / QuickCommands 在 large bucket 必須有「alternate layout」標記字串或 flag（契約測試讀檔）

**手動驗收矩陣**（iOS 實機）

| 系統文字大小 | 檢查點 |
|--------------|--------|
| 預設 | 視覺與現況設計稿一致（±1–2px） |
| 較大 | Sheet 可捲、卡片 command 不溢出 |
| 最大 | 無文字被 clip；主要 CTA 仍可點；頭像大小一致 |

### 3.5 Font size bucket API

```ts
// 基於 PixelRatio.getFontScale() 或 RN AccessibilityInfo
export type FontScaleBucket = 'regular' | 'large' | 'xl';

export function fontScaleBucket(scale: number): FontScaleBucket {
  if (scale < 1.15) return 'regular';
  if (scale < 1.35) return 'large';
  return 'xl';
}
```

`useFontScaleBucket()` hook 供 MapScreen / QuickCommands / StepShell 訂閱。

### 3.6 與「強制深色系統 UI」的關係

- `userInterfaceStyle: "dark"` **保留**（chrome 永遠深色系統語意）。  
- Dynamic Type 與 color scheme **正交**：大字仍在 dark glass 上用 light text。  
- Day **地圖主題** 仍可存在；onboarding theme step 選 day 時，onboarding 背景可偏暖米白，但 map glass 規則不變。

### 3.7 實作 phases（Dynamic Type only）

| Phase | 交付 | 驗證 |
|-------|------|------|
| DT-1 | `typeScale` + `HitherText` + 移除全域 cap=1 | typecheck + 契約測試 |
| DT-2 | Onboarding 全 step 改 HitherText + StepShell 彈性 | Expo Go 最大字級走完 onboarding |
| DT-3 | Map glass：carousel / flock / quick commands 的 large/xl layout | 最大字級 map 主流程 |
| DT-4 | 掃尾 TextInput、Settings overlays | 回歸 |

**風險**：DT-1 若只拆 cap 不做 layout，會短暫回退 BUG-01～03。故 **DT-1 與 DT-2/3 中關鍵 fixed-height 元件必須同 PR 或緊接**；至少同批上線 map 卡片 + quick commands + avatar 固定殼。

---

## 4. Spec B — Onboarding 主題選擇重設計（ThemeStep）

### 4.1 現況診斷

- 實心 accent 填滿 2×2 方格 → 像 paint chip，不是「地圖主題預覽」。  
- 白邊 ring 違背 DS「depth via colored glow, not white borders」。  
- Label 直接壓在飽和色上，日/夜主題可讀性不一。  
- 無迷你 basemap／glass 示意，選完無法預期 map 長怎樣。

### 4.2 設計方向（對齊 DS + high-end glass）

**每個主題 = 一張「迷你地圖場景卡」**

```
┌─────────────────────────┐
│  basemap 漸層（該主題）   │  ← 不是純 accent 色塊
│  · 淡淡路徑弧線           │
│  · 小 crook / 🚩 beacon  │  ← accent 色
│  ┌───────────────────┐  │
│  │ glass 假 sheet 條  │  │  ← 底部一條 glass 預覽
│  └───────────────────┘  │
│  夜燈                     │  ← 底部 label 區（深色玻璃或 ink）
└─────────────────────────┘
     selected: accent glow + scale 1.03 + check pill
```

#### 4.2.1 視覺規格

| 項目 | 規格 |
|------|------|
| Grid | 2×2，`gap: 14`，card `borderRadius: 24`（DS card） |
| 比例 | `aspectRatio ≈ 0.92`（略高，給 basemap + label 空間）或 1:1 但 label 疊在底部 glass 條 |
| 未選中 | 無白邊；極淡 hairlineSoft 或無邊；opacity 0.92 |
| 選中 | `shadowColor: accent`，`shadowOpacity ~0.45`，`shadowRadius 16`；內嵌 soft ring 用 **accentMix(accent, 50)** 而非純白；右上 check 用 accent 底 + accentText 勾 |
| Press | scale 0.97（DS press-scale 精神）+ `selectionTick` haptic |
| Label | Fredoka / semibold 17–18；顏色用該主題 `textPrimary` 或固定白字於深色 label bar |
| 即時套用 | 維持現況：`setThemeName` 立即生效，StepShell 背景隨之變（day → 米白允許） |

#### 4.2.2 四主題 basemap 色（示意，可微調）

| Theme | Basemap 基調 | Accent beacon |
|-------|--------------|---------------|
| night | `#0E1320` → `#16264A` | `#F5B142` |
| day | `#E8F0F8` → `#F7F5F0` | `#E0912B` |
| dusk | `#15101F` → `#2A1B3D` | `#F08FB0` |
| forest | 深綠 ink | 森林 accent（現 theme.ts） |

每個卡內可畫：

- 1 條低對比 path（polyline 感的 View 弧）  
- 1 個小 gather beacon（圓 + 外圈 pulse **僅選中時** 一次或慢呼吸，避免整頁四卡狂閃）  

#### 4.2.3 文案 / a11y

- 維持 i18n keys：`onboarding.theme.*`  
- `accessibilityState.selected`  
- `accessibilityLabel`：主題名 + 「已選取」  

#### 4.2.4 UX

- **Smart default**：進入頁時若尚未選，預選 `night` 並顯示選中態。  
- CTA「繼續」在未選時 disable（理論上永遠有 default）。  
- 不新增步驟。

### 4.3 不做

- 不要橫向 scroll 色票  
- 不要 4 個巨大 emoji 當唯一識別  
- 不要 Material 風格 outlined button grid  

### 4.4 驗收

- [ ] 四卡在 dark/light onboarding 背景下都清楚  
- [ ] 選中 glow 可辨、無「白框貼紙」感  
- [ ] 點選即時換 onboarding 背景色  
- [ ] 系統最大字級：label 可 2 行或 ellipsis，卡不重疊  

---

## 5. Spec C — Onboarding Intro 動畫重設計

### 5.1 現況診斷

- 語意弱：灰點散開不像「隊員」。  
- **Infinite loop** 違 DS motion 原則。  
- 缺 crook／emoji／旗幟等品牌符號。  
- UI kit Onboarding 使用大 hero emoji + 雙行 Fredoka 標題 — 現況只有小圓點。

### 5.2 敘事（必須讀得出）

**三拍故事（約 2.4–2.8s 播完一次，然後停在「已集合」靜態幀；可選擇緩慢呼吸，不可劇烈循環散開）：**

1. **Scatter（走散）** — 3–5 個 member emoji（或柔色 avatar 圓）散在舞台邊緣，低 opacity。  
2. **Call（召集）** — 中央 crook 或 accent beacon 淡入；可選短 haptic 無。  
3. **Gather（聚攏）** — members spring 收向中心集合點；抵達後形成小半圓或弧，beacon 輕 pulse **一次**。  

靜止幀文案（已有）：

- Title：`onboarding.intro.title`（牽起隊伍…）  
- Body：`onboarding.intro.body`  
- CTA：`onboarding.intro.start`  

可選 kicker 小 pill：「Hither」或「把走散的夥伴，聚在一起」——若加文案需走 i18n。

### 5.3 動效規格（Reanimated）

| 參數 | 值 |
|------|----|
| 技術 | `react-native-reanimated` only `transform` + `opacity`（GPU-safe） |
| Easing | gather 用 spring（stiffness ~180, damping ~16）；fade 用 cubic-bezier 感的 out cubic |
| Duration | scatter 0–400ms → call 400–900ms → gather 900–2200ms → settle |
| Loop | **預設不 loop**；若要「活感」，僅 beacon 透明度 0.85↔1 呼吸 2.5s，members **靜止** |
| Reduce Motion | `AccessibilityInfo.isReduceMotionEnabled` → 直接顯示 settle 幀，無動畫 |
| 舞台高度 | `minHeight` 随 font bucket：regular 240 / large 200 / xl 可縮 hero 讓出標題空間 |

### 5.4 視覺規格

| 元素 | 規格 |
|------|------|
| Stage | 居中，寬 ~280 |
| Beacon | crook icon 或 accent 圓 44–56；可叠 🚩 小標 |
| Members | 4 個 emoji avatar 圓（32–36），白/深 ring 1.5；顏色用 MEMBER_COLORS 或 accent 淡化 |
| Background | 可加極淡 radial glow（accent 8% opacity），不要雜訊顆粒滿版 |
| Title | Fredoka display，允許多行；Dynamic Type role=`display` |

### 5.5 與 Progress / Goal-Gradient

- Intro 完成後進度應讓使用者覺得「已經開始」（現有 ProgressDots 若 intro 算第 1 點，保持即可）。  
- CTA 文案維持「開始」——進入 theme 是 ownership 第一步。

### 5.6 驗收

- [ ] 3 秒內可理解「聚在一起」  
- [ ] Reduce Motion 下無動畫但仍好看  
- [ ] 無無限散開循環  
- [ ] 大字級下標題 + 動畫 + CTA 不互相擠壓（可縮 stage）  

---

## 6. 檔案影響地圖

| 區域 | 路徑 | 動作 |
|------|------|------|
| 全域 cap 移除 | `apps/mobile/App.tsx` | 刪除 maxFontSizeMultiplier=1；可保留 dark StatusBar |
| Type system | `apps/mobile/src/theme/typeScale.ts`（新） | roles + multipliers |
| Text primitives | `apps/mobile/src/components/HitherText.tsx`（新） | 封裝 |
| Font bucket | `apps/mobile/src/a11y/useFontScaleBucket.ts`（新） | hook |
| Onboarding UI | `steps/IntroStep.tsx` | 重做動畫 |
| Onboarding UI | `steps/ThemeStep.tsx` | 重做主題卡 |
| Onboarding shell | `steps/StepShell.tsx`, `PrimaryButton.tsx` | HitherText + minHeight |
| Map layout variants | `MapScreen.tsx`, `QuickCommandsCard.tsx` | large/xl layout |
| Avatar | flock / avatar cells | 固定殼 + emoji no-scale |
| 契約測試 | `src/__tests__/dynamicTypeContract.test.ts` | 新 |
| 本 spec | `docs/superpowers/specs/2026-07-14-dynamic-type-onboarding-polish-design.md` | 本文 |

**不動**：`flow.ts`、`content.ts` 步驟資料、Supabase、原生 Live Activity（除非字級與之無關）。

---

## 7. 實作順序（建議 PR 切分）

```
PR1  DT 基礎（typeScale + HitherText + avatar 固定殼 + 移除 cap）
       + Map/QuickCommands large layout 最小集（避免回歸 BUG-01）
PR2  ThemeStep 重設計
PR3  IntroStep 動畫重設計
PR4  Onboarding 其餘 steps 換 HitherText + StepShell 彈性
PR5  Map glass 全量 large/xl 收斂 + 契約測試補齊
```

每 PR：`npm test && npm run typecheck`；PR2–4 需 **Expo Go 實機** 走 onboarding。  
Dynamic Type 最大字級驗收在 PR1 + PR5 各做一次。

---

## 8. 風險與決策記錄

| 風險 | 緩解 |
|------|------|
| 只開縮放不做 layout → UI 炸裂 | 同一 release 綁定 critical layout variants |
| Fredoka 不涵蓋 CJK | CJK 用系統字；display 只強調節奏，lineHeight 放寬 |
| 四主題卡效能 | 純 View 漸層，不用每卡 MapView |
| Intro 動畫電量 | 播完即停；Reduce Motion 直達 settle |
| 使用者習慣 cap=1 的「字不變」 | 產品上正確；changelog 註明「現在會跟隨系統文字大小」 |

### 已定決策（本 spec）

1. **真 Dynamic Type**：有上限的跟随，不是 cap=1，也不是無限放大。  
2. **Emoji 頭像不跟隨字級**；文字跟隨。  
3. **Theme 選擇 = 迷你地圖預覽卡**，不是色票。  
4. **Intro = scatter→gather 敘事，預設不 infinite loop**。  
5. **Onboarding 狀態機不改**。

### 待產品確認（可實作時再問）

1. 最大倍率是否接受 **1.3**，或要更保守 **1.2**？  
2. Intro settle 後 beacon 是否允許極慢呼吸？  
3. Theme 卡是否要顯示小字副標（如「適合夜間」）？預設 **不要**，保持乾淨。

---

## 9. 驗收清單（總）

### Dynamic Type

- [ ] 系統預設字：視覺接近現設計  
- [ ] 系統最大字：Sheet / 卡片 / 快捷指令不溢出、可操作  
- [ ] 頭像 emoji 大小一致  
- [ ] 無全域 `maxFontSizeMultiplier = 1`  
- [ ] Reduce Motion 不影響字級（字級與動效分離）  

### ThemeStep

- [ ] 四主題預覽可辨（night/day/dusk/forest）  
- [ ] 選中 glow + check，無廉價白框  
- [ ] 即時套用主題  
- [ ] 大字級可讀  

### IntroStep

- [ ] 敘事 scatter → gather 可理解  
- [ ] 非無限裝飾循環  
- [ ] Reduce Motion 靜態仍好看  
- [ ] 與 DS crook / flock 隱喻一致  

### 工程

- [ ] `npm test && npm run typecheck`  
- [ ] Expo Go 實機 onboarding 全分支（leader / follower / browser 至少各 1）  
- [ ] 進度可寫入 `docs/bug-fixes-plan.md` 或本 spec 底部 changelog  

---

## 10. 參考

- `docs/Hither Design System/readme.md` — north star、glass、type、motion  
- `docs/Hither Design System/tokens/typography.css` — type scale  
- `docs/Hither Design System/tokens/motion.css` — duration / ease / press-scale  
- `docs/Hither Design System/ui_kits/hither_ios/Onboarding.jsx` — hero 結構參考  
- `docs/onboarding-redesign-brief.md` — 流程邊界（勿亂改 flow）  
- 現況：`App.tsx` cap、`ThemeStep.tsx`、`IntroStep.tsx`  
- 前次暫解：BUG-01～03（本 spec 取代）

---

## Changelog

| 日期 | 變更 |
|------|------|
| 2026-07-14 | 初版 spec：Dynamic Type 分級適配 + Theme 預覽卡 + Intro gather 動畫 |
