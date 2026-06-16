# Xcode Live Activity 配置指南

## 修復 "unsupportedTarget" 錯誤

`unsupportedTarget` 錯誤表示項目缺少 Live Activities 的必要配置。

### 1. 主 App Target (Hither) 配置

#### Step 1: 添加 Entitlements
1. 在 Xcode 中選擇 **Hither** target
2. 點擊 **Signing & Capabilities** tab
3. 點擊 **+ Capability**
4. 搜索並添加 **"Live Activity"** capability
5. 或者手動設置：
   - Code Signing Entitlements: `Hither/Hither.entitlements`

#### Step 2: 添加 Info.plist 配置
1. 選擇 **Hither** target
2. 點擊 **Info** tab
3. 在 **Custom iOS Target Properties** 部分添加以下 keys：
   - 點擊 **+** 按鈕
   - 添加 `NSSupportsLiveActivities` = `YES` (Boolean)
   - 添加 `NSSupportsLiveActivitiesFrequentUpdates` = `YES` (Boolean)

**注意：不要創建單獨的 Info.plist 文件，直接在 target 設置中配置即可**

#### Step 3: 檢查 Bundle Identifier
1. 確保 Bundle Identifier 是有效的（例如：`com.yourname.hither`）
2. 確保 Team 設置正確

### 2. Widget Extension Target (WidgetsExtension) 配置

#### Step 1: 添加 Entitlements
1. 選擇 **WidgetsExtension** target
2. 點擊 **Signing & Capabilities** tab
3. 添加 **"Live Activity"** capability
4. 設置 Code Signing Entitlements: `Widgets/WidgetsExtension.entitlements`

#### Step 2: 檢查 Bundle Identifier
1. 確保 Widget Extension Bundle Identifier 是主 app 的子集
2. 例如：`com.yourname.hither.WidgetsExtension`

### 3. 驗證配置

#### 檢查 Entitlements 文件內容：

**Hither.entitlements:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.usernotifications.live-activities</key>
    <true/>
    <key>aps-environment</key>
    <string>development</string>
</dict>
</plist>
```

**WidgetsExtension.entitlements:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.usernotifications.live-activities</key>
    <true/>
    <key>aps-environment</key>
    <string>development</string>
</dict>
</plist>
```

#### 檢查 Info.plist 配置：

在 Xcode target 設置中，**Info** tab 的 **Custom iOS Target Properties** 應該包含：
- `NSSupportsLiveActivities` = `YES` (Boolean)
- `NSSupportsLiveActivitiesFrequentUpdates` = `YES` (Boolean)

### 4. 設置步驟

1. **打開 Hither.xcodeproj**
2. **對於主 App target (Hither)**：
   - Signing & Capabilities > + Capability > Live Activity
   - Info > Custom iOS Target Properties > 添加 `NSSupportsLiveActivities = YES` (Boolean)
   - 確保 Code Signing Entitlements 指向 `Hither/Hither.entitlements`
3. **對於 Widget Extension target**：
   - Signing & Capabilities > + Capability > Live Activity
   - 確保 Code Signing Entitlements 指向 `Widgets/WidgetsExtension.entitlements`
4. **清理並重新編譯**：
   - Product > Clean Build Folder
   - Product > Build

### 5. 驗證配置是否正確

運行 app 並檢查 console 日誌：
- 如果看到 `✅ Successfully started Live Activity`，配置正確
- 如果仍然看到 `unsupportedTarget`，檢查上述配置

### 6. 故障排除

#### 如果仍然出現 "unsupportedTarget"：
1. 檢查 iOS Deployment Target >= 16.1
2. 檢查設備是 iPhone（不是 iPad 或模擬器）
3. 檢查 Bundle Identifier 是否唯一且有效
4. 檢查 Apple Developer Account 設置
5. 嘗試重啟 Xcode 和清理項目

#### 如果出現證書問題：
1. 確保有有效的 Apple Developer Account
2. 檢查 Provisioning Profile 包含 Live Activities capability
3. 在設備上信任 developer certificate

### 7. 測試

配置完成後：
1. 重新編譯並運行 app
2. 進入群組詳情頁面
3. 點擊 "Test Live Activity" 按鈕
4. 檢查 Dynamic Island 和 Lock Screen