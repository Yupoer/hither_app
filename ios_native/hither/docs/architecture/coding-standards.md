### **5. `architecture/coding-standards.md`**

```markdown
# Hither App 程式碼標準 (Coding Standards)

**版本:** 1.1 更新

### 1. 架構標準

* **嚴格遵守 MVVM + Service Layer**：
    * **Views**：只能包含 UI 邏輯和狀態綁定，不得包含任何業務邏輯。
    * **Services (作 ViewModel 使用)**：必須是 `@MainActor` 的 `ObservableObject`。所有業務邏輯、數據請求 (Firebase, Google API)、狀態管理都必須封裝在 Service 層。
    * **Models**：必須是簡單的 `Struct` 或 `Enum`，並遵循 `Codable` 協議以便與 Firestore 交互。

### 2. UI 開發標準

* **禁止硬編碼 (Hardcoding)**：嚴禁在 View 中直接使用硬編碼的顏色、字體大小、間距或字串。
* **必須使用設計規範 (Design System)**：
    * **[新增]** **唯一真相來源**: 所有 UI 相關的開發，都必須嚴格遵循 `DSD.md` v1.2 的視覺與互動規範。
    * **顏色**：所有顏色都必須透過 `ThemeManager` 和 `ThemeConfiguration` 從設計規範中獲取。
    * **字體**：應使用如 `ThemeTextStyles.swift` 中定義的語意化樣式。
    * **組件**：應優先使用 `DarkBlueThemeSystem.swift` 中定義的標準組件。

### 3. 數據流與服務層標準

* **單向數據流**：數據應從 Service 流向 View。View 透過呼叫 Service 的方法來觸發狀態變更。
* **服務注入 (Dependency Injection)**：所有 Service 都應作為 `EnvironmentObject` 注入到 SwiftUI 的視圖層級中。
* **錯誤處理**：Service 層必須處理來自 API 或資料庫的錯誤，並將其轉化為可供 UI 顯示的、用戶友好的錯誤狀態。

### 4. Firebase 使用標準

* **禁止直接訪問**：嚴禁在 View 或 Model 中直接呼叫 Firebase SDK。所有 Firebase 操作都必須被封裝在對應的 Service 內部。
* **監聽器管理**：`addSnapshotListener` 等即時監聽器，必須在視圖生命週期結束時被正確地移除，以防止記憶體洩漏。

### 5. 程式碼風格

* 遵循標準的 Swift API Design Guidelines。
* 使用 SwiftLint 等工具來自動化檢查和維持程式碼風格的一致性。