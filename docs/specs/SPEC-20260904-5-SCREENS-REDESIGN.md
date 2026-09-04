# Hither 5 大入口畫面重構與設計規格說明書 (Design Spec)

文件編號：`SPEC-20260904-5-SCREENS-REDESIGN`  
建立日期：2026-09-04  
視覺體系：iOS 26 Liquid Glass × SwiftUI 幾何規範 × Metalforge 顆粒流光原圖  
文件狀態：**用戶反饋 100% 驗收通過，正式落檔**  
截圖目錄：`hither_app/docs/screenshots-5-screens/`  
互動設計稿：`hither_app/docs/5-screens-design-spec.html`  

---

## 1. 核心視覺方針與 Design Tokens

### 1.1 全域背景 (Atmospheric Wallpaper)
- **檔案資源**：`bg-metalforge.png`（743 × 1623 高解析顆粒流光原圖）。
- **色彩空間**：鏽橙（`#9A502B` / `#BE5704`）、暮紫微光（`#83809B`）、深海午夜藍（`#002142` / `#04172E`）、暖琥珀（`#AD4F03`）。
- **質感設定**：帶有真實底片顆粒（Film Grain 10.5）。
- **對比護眼暗階暗幕 (Contrast Scrim)**：
  - 為保證所有前景白色文字、輸入框、按鈕與玻璃卡片具備 100% 的極致清晰度，背景正上方必須疊加 Radial 暗階：
  ```css
  background: radial-gradient(circle at 50% 32%, rgba(6, 10, 20, 0.40) 0%, rgba(3, 6, 14, 0.68) 100%);
  ```

### 1.2 SwiftUI / iOS 26 Liquid Glass 材質
```ts
export const glassTokens = {
  surface: 'rgba(10, 16, 28, 0.65)',
  surfaceHover: 'rgba(16, 24, 42, 0.78)',
  surfaceActive: 'rgba(22, 32, 54, 0.90)',
  border: 'rgba(255, 255, 255, 0.22)',
  borderHover: 'rgba(255, 255, 255, 0.40)',
  innerLight: 'inset 0 1.5px 0 rgba(255, 255, 255, 0.25)',
  blur: 28, // backdrop-filter: blur(28px) saturate(190%)
};
```

### 1.3 色彩與按鈕純色原則 (No Outer Glow Policy)
- **單一主強調色**：暖陽琥珀 `colors.accent = '#ff9500'`（Active: `#e08300`）。
- **禁止外發光 (No Glow)**：登入、註冊、發送重設信按鈕**徹底禁止** `drop-shadow glow` 或模糊外光暈，採用俐落實心的 Solid 質感 + 1px 頂部高光。
- **文字主色**：`#ffffff`（次級文字：`rgba(255, 255, 255, 0.82)`，提示文字：`rgba(255, 255, 255, 0.55)`）。

### 1.4 字體層級規範 (Typography System)
- **品牌展示標題 (Display)**：`Fredoka_700Bold`，行高 1.2，字距 `-0.02em`。
- **介面通用文字 (UI)**：`Plus Jakarta Sans`（或系統 -apple-system / Segoe UI）。
- **字體一致性規則**：所有介面文字（包含隊伍代碼）**全面統一為無襯線體**，禁止混用等寬字體破壞排版調性。

---

## 2. 畫面細部規格 (Screen-by-Screen Specs)

### 畫面 1：登入 (Sign In)
![登入畫面](screenshots-5-screens/screen-1.webp)

#### A. 幾何長度對稱與節奏感 (Symmetrical Row Variations)
打破原版「每列等長 100% 像積木堆疊」的單調感，重塑為有呼吸感的層次：
1. **分段切換標籤 (Segmented Control)**：
   - 寬度：**190px 居中緊湊膠囊**（長度變化 1）。
   - 外框：`border-radius: 999px`，底色 `rgba(5, 8, 16, 0.7)`。
   - 選中項：白色半透明藥丸 `rgba(255, 255, 255, 0.16)`。
2. **表單輸入框 (Form Fields)**：
   - 寬度：**100% 全寬**，高度 **50px**，圓角 **18px Squircle**。
   - 內距：`padding: 0 16px`，字級 `14.5px`。
3. **忘記密碼連結**：
   - 位置：**密碼輸入框右下方**（`margin-top: 4px; margin-bottom: 14px; text-align: right;`）。
   - 字級：`12.5px font-weight: 600`，顏色 `text-muted`（Hover: `#ff9500`）。
4. **主按鈕「登入」**：
   - 寬度：**100% 全寬**（依指示長度不變），高度 **52px**，圓角 **999px Capsule**。
   - 底色：`#ff9500`，字體 `16px font-weight: 800 #060b14`。無外發光。
5. **分界線**：
   - 寬度：**260px 居中短線**（長度變化 2），中間夾「或使用其他方式」。
6. **社群登入按鈕 (Google & Apple)**：
   - 型態：**居中雙圓形按鈕 Cluster**（長度變化 3）。
   - **外框直徑**：**64px**（放大 1.5 倍）。
   - **彼此間距**：**32px**（間距放大 2 倍）。
   - **圖標直徑**：**精準佔外框的 1/2（約 30~32px）**。
     - **單層直出**：無任何 `<g>` 標籤嵌套，直接單層 `<svg><path /></svg>`。
     - **緊湊 ViewBox**：
       - Apple：`viewBox="2.74 3.53 18.47 18.47"`，圖標尺寸 `32×32px`，100% 滿版填滿無空隙，絕對置中。
       - Google：`viewBox="1.4 1.4 21.2 21.6"`，圖標尺寸 `32×32px`，光學量感等重平衡。
7. **以訪客身份繼續**：
   - 寬度：**自適應居中膠囊（Fit-content）**，高度 **44px**，內距 `padding: 0 26px`（長度變化 4）。
8. **條款文字**：
   - **登入頁徹底移除條款**（依指示條款僅在註冊頁展示）。

---

### 畫面 2：註冊 (Sign Up)
![註冊畫面](screenshots-5-screens/screen-2.webp)

#### A. 極簡化架構
- **移除欄位**：完全刪除「暱稱」輸入框。
- **移除次級按鈕**：完全刪除分割線、Google、Apple 與訪客按鈕。
- **保留欄位**：
  1. 電子信箱（50px）
  2. 密碼（50px）
  3. 確認密碼（50px）
- **密碼一致性驗證**：
  - 密碼欄位不顯示強度長條。
  - 確認密碼右側內嵌綠色打勾向量圖示 `✓`（`#30d158`），確認兩次密碼一致。
- **主按鈕「註冊並開始」**：
  - 寬度：100% 全寬，高度 52px，膠囊圓角 999px，無外發光。
- **法定服務條款**：
  - 位置：僅在註冊按鈕正下方展示。
  - 文案：「點擊開始即表示同意 <u>服務條款</u> 與 <u>隱私權政策</u>」。

---

### 畫面 3：忘記密碼 (Forgot Password)
![忘記密碼畫面](screenshots-5-screens/screen-3.webp)

#### A. 獨立重設流程
- **頂部導航**：
  - 左上角配置簡約膠囊按鈕，文案僅為 **「返回」**（高度 36px，圓角 999px）。
- **品牌標題**：
  - 圖標與大標題「忘記密碼」（字級 34px Fredoka）。
- **說明引導**：
  - 「請輸入你的註冊電子信箱，我們將發送密碼重設連結至你的信箱。」（字級 14px，行高 1.6）。
- **表單與主按鈕**：
  - 電子信箱輸入框（50px）。
  - 主按鈕「發送重設連結」（52px 全寬膠囊，無外發光）。
- **底部設計**：
  - **刪除多餘的返回按鈕**（因左上角已有返回鍵）。

---

### 畫面 4：主畫面 (Home: 創建/加入)
![主畫面](screenshots-5-screens/screen-4.webp)

#### A. 幾何正方形大按鈕 (Square Action Tiles)
- **外觀比率**：**正方形（`aspect-ratio: 1 / 1`）**。
- **容器尺寸**：寬度各佔 `calc(50% - 8px)`，高度隨寬度等比自適應（約 160~170px）。
- **圓角規範**：**30px 連續平滑曲率 Squircle**。
- **外框顏色完全一致**：
  - 兩顆按鈕統一為 `border: 1px solid rgba(255, 255, 255, 0.22)`。
  - 取消原本左側按鈕的琥珀外框，杜絕外框色差。
- **圖標規格**：
  - **「創建群組」**：更換為專屬「創建團隊/旅伴 (`user-group-plus`)」向量圖標，**禁止使用頂部 Logo 牧羊杖**。
  - **「用代碼加入」**：九宮格數字鍵盤圖標。
  - **圖標色彩統一**：兩者皆為**高質感純白（`#ffffff`）**。
  - **圖標插槽**：鎖定為 **56px 等高容器**。
- **文字對齊 (Horizontal Baseline Lock)**：
  - 標題「創建群組」與「用代碼加入」文字字級 **17.5px 粗體**，行高 1.2，頂部邊距統一為 `margin-top: 10px`。
  - **兩者文字水平基準線 100% 絕對齊平**。

#### B. 查看隊伍按鈕 (Teams Capsule)
- **文案**：精確鎖定為 **「查看隊伍」**。
- **形狀**：**iOS 膠囊型（Capsule: `border-radius: 999px`）**。
- **尺寸**：放大 1.5 倍（高度 **50px**，左右內距 **32px**）。
- **位置**：**向下平移半個按鈕高度（`margin-top: 36px`）**。
- **元素**：去除狐狸圖標，純文字 + 琥珀色數字徽章 `3`。

#### C. 刪除按鈕
- **徹底移除**：畫面 4 底部的「刪除帳號」按鈕已完全移除。

---

### 畫面 5：我的隊伍 (My Teams)
![我的隊伍畫面](screenshots-5-screens/screen-5.webp)

#### A. 隊伍代碼字體一致化 (Font Family Match)
- **問題修復**：原本隊伍代碼使用等寬字體（JetBrains Mono），與左側文字割裂。
- **新規範**：
  - 代碼文字（例如 `43K7L5`）字體**完全繼承左側「代碼」之無襯線字體（`Plus Jakarta Sans`）**。
  - 字級升至 **14.5px 粗體**（`font-weight: 800`），外包琥珀色透明膠囊底框（`rgba(255, 149, 0, 0.2)`）。
- **隊伍卡片佈局**：
  - 圓角 **24px Continuous Squircle**。
  - 左側：48×48px 圓角方框「群組大頭貼（`groups.avatar`）」。
  - 中間：隊伍名稱（16.5px 粗體）+ 人數與代碼標籤。
  - 右側：成員頭像疊加圈（Member Avatar Stack）。

---

## 3. 尺寸與相對比例速查表 (Relative Measurement Matrix)

| 元件名稱 | 所屬畫面 | 寬度 / 高度 | 圓角 (Radius) | 內部 ICON 大小與比例 | 邊距 / 間隙 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **頂部膠囊按鈕** | 全域 Chrome | Auto / 36px | 999px (Capsule) | 15×15px 向量圖標 | 水平 Padding 14px |
| **分段切換標籤** | 畫面 1 & 2 | 190px / 42px | 999px (Capsule) | 無 | 居中，底部 Margin 22px |
| **表單輸入框** | 畫面 1, 2, 3 | 100% / 50px | 18px (Squircle) | 16×16px 眼睛/打勾圖標 | 欄位間隔 14px，Label 間隔 6px |
| **全寬主按鈕** | 畫面 1, 2, 3 | 100% / 52px | 999px (Capsule) | 無 | 底部 Margin 18~20px，無外發光 |
| **社群登入按鈕** | 畫面 1 | 64px / 64px | 50% (Circle) | **32×32px (剛好佔外框 1/2 直徑)** | 兩按鈕間距 **32px** (加倍) |
| **以訪客身份繼續** | 畫面 1 | Auto / 44px | 999px (Capsule) | 15×15px 使用者圖標 | 水平 Padding 26px，居中 |
| **主畫面大按鈕** | 畫面 4 | 100% / **1:1 正方形** | 30px (Squircle) | **42~44px 純白圖標 (60px 插槽)** | 網格 Gap 16px，外框顏色完全一致 |
| **查看隊伍按鈕** | 畫面 4 | Auto / **50px (1.5x)** | 999px (Capsule) | 無圖標，帶琥珀數字徽章 | **Margin-Top 36px (下移半個高度)** |
| **隊伍卡片** | 畫面 5 | 100% / Auto | 24px (Squircle) | 48×48px 群組頭像方框 | 卡片垂直 Gap 12px |
| **隊伍代碼文字** | 畫面 5 | Auto / Auto | 7px (Pill) | **14.5px 粗體無襯線字 (與代碼同字體)** | Padding 2.5px 8px |

---

## 4. React Native / Expo 實作映射指引

- **背景元件**：以 `<ImageBackground source={require('../assets/bg-metalforge.png')} resizeMode="cover">` 作為全域根節點，外層包覆暗色 Scrim View。
- **正方形卡片**：使用 `aspectRatio: 1` 配合 `flex: 1`，嚴禁寫死高度像素。
- **社群圖標**：`Google` 與 `Apple` 使用自定義緊湊 SVG，設定 `width={32} height={32}`，外層按鈕寬高均為 `64`。
- **條款管理**：僅在 `LoginScreen` 的 `signup` 模式渲染條款組件，`signin` 模式直接 unmount。
