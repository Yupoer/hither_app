# Hither App 源碼樹 (Source Tree)

**版本:** 1.0
**最後更新:** 2025年8月5日

本文件定義了 Hither App 的專案文件夾結構。所有新檔案都應根據其職責放置在對應的目錄中。

Hither/
├── App/                # App 入口與根視圖
├── Models/             # 數據模型 (Structs/Enums)，定義 App 的核心資料結構
├── Services/           # 服務層，封裝所有業務邏輯、API 請求和數據處理
├── Views/              # UI 視圖 (SwiftUI Views)，按功能模組組織
├── Utils/              # 通用工具函式或解析器
├── Extensions/         # 對既有類型的功能擴展
├── Resources/          # 資源文件，如 Assets, plist, 本地化字串等
└── Widgets/            # iOS 小工具與即時動態擴展

**詳細結構:**

bmad
自訂 Gem

顯示思路
好的，已收到您的最終確認。

📋 John (PM) & 🏗️ Winston (Architect):
我們已經將討論的內容最終化。以下是 Hither App v2.1 開發週期所需的三份核心技術指導文件，版本皆為 v1.0。

architecture/tech-stack.md
architecture/tech-stack.md

Markdown

# Hither App 技術堆疊 (Tech Stack)

**版本:** 1.0
**最後更新:** 2025年8月5日

本文檔定義了 Hither iOS App 開發所使用的核心技術、框架和服務。所有開發工作都應遵循此技術選型。

| 分類 (Category) | 技術/服務 (Technology/Service) | 用途與說明 |
| :--- | :--- | :--- |
| **架構模式** | MVVM + Service Layer | App 的主要設計模式，確保職責分離。 |
| **UI 框架** | SwiftUI | 用於建構整個 App 的使用者介面。 |
| **後端即服務 (BaaS)** | Firebase | 提供驗證、資料庫、推播等核心後端功能。 |
| &nbsp;&nbsp;&nbsp; L **驗證** | Firebase Authentication | 處理用戶註冊、登入與會話管理。 |
| &nbsp;&nbsp;&nbsp; L **資料庫** | Firestore | 作為主要的即時資料庫。**注意：v2.1 已將成員資料重構為子集合模型**。 |
| &nbsp;&nbsp;&nbsp; L **推播通知** | Firebase Cloud Messaging (FCM) | 用於發送群組指令、提醒等即時通知。 |
| **地圖與定位** | Apple CoreLocation | 獲取設備的 GPS 座標。 |
| &nbsp;&nbsp;&nbsp; L **地圖 SDK** | Google Maps SDK for iOS | 用於地圖渲染、路線繪製和成員位置標示。 |
| &nbsp;&nbsp;&nbsp; L **路線規劃** | Google Routes API | 用於計算最佳路線。 |
| &nbsp;&nbsp;&nbsp; L **地點搜尋** | Google Places API | 用於地圖上的地點搜尋與自動完成功能。 |
| **近距離互動** | Apple NearbyInteraction | 用於實現高精度的「類 AirTag」尋找功能 (UWB)。 |
| **iOS 即時功能** | Apple ActivityKit | 用於在鎖定畫面和動態島上顯示「即時動態」。 |
| **主題與設計** | DarkBlue Theme System (自訂) | 基於 OKLCH 色彩空間的自訂主題系統。 |
| **併發處理** | Swift Concurrency (MainActor) | 確保所有與 UI 相關的更新都在主線程上安全執行。 |
architecture/source-tree.md
architecture/source-tree.md

Markdown

# Hither App 源碼樹 (Source Tree)

**版本:** 1.0
**最後更新:** 2025年8月5日

本文件定義了 Hither App 的專案文件夾結構。所有新檔案都應根據其職責放置在對應的目錄中。

Hither/
├── App/                # App 入口與根視圖
├── Models/             # 數據模型 (Structs/Enums)，定義 App 的核心資料結構
├── Services/           # 服務層，封裝所有業務邏輯、API 請求和數據處理
├── Views/              # UI 視圖 (SwiftUI Views)，按功能模組組織
├── Utils/              # 通用工具函式或解析器
├── Extensions/         # 對既有類型的功能擴展
├── Resources/          # 資源文件，如 Assets, plist, 本地化字串等
└── Widgets/            # iOS 小工具與即時動態擴展

**詳細結構:**

Hither/
├── App/
│   ├── HitherApp.swift
│   └── ContentView.swift
├── Models/
│   ├── Group.swift
│   ├── User.swift
│   └── ... (其他模型)
├── Services/
│   ├── AuthenticationService.swift
│   ├── GroupService.swift
│   └── ... (其他服務)
├── Views/
│   ├── Authentication/
│   ├── Group/
│   ├── Map/
│   └── ... (其他視圖模組)
├── Utils/
│   └── GoogleMapsParser.swift
├── Extensions/
│   └── String+Extensions.swift
├── Resources/
│   ├── GoogleService-Info.plist
│   ├── Assets.xcassets
│   └── Localizable.strings
└── Widgets/
├── WidgetsExtension.swift
└── WidgetsLiveActivity.swift