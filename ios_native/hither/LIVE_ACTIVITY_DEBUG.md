# Live Activity 調試指南

## 檢查清單

### 1. 設備要求
- iOS 16.1 或更高版本
- iPhone（Live Activities 不支援 iPad）
- 實體設備（模擬器可能不完全支援）

### 2. 系統設置
- 設定 > 通知 > 實時動態 > 開啟
- 設定 > 通知 > Hither > 實時動態 > 開啟

### 3. Xcode 項目配置

#### 主 App Target 配置
在 Xcode 中：
1. 選擇 Hither target
2. Info tab > Custom iOS Target Properties
3. 添加：`NSSupportsLiveActivities` = `YES`

#### Widget Extension Target 配置
1. 確保 Widget Extension 存在
2. 確保 `HitherGroupLiveActivity` 在 `WidgetsBundle` 中註冊
3. 確保 `HitherGroupAttributes` 在兩個 target 中都可用

### 4. 代碼檢查

#### LiveActivityService.swift
- 確保 `ActivityAuthorizationInfo().areActivitiesEnabled` 返回 true
- 檢查 console 日誌中的錯誤訊息

#### WidgetsLiveActivity.swift
- 確保 `HitherGroupAttributes` 正確定義
- 確保 `HitherGroupLiveActivity` 正確實現

### 5. 測試步驟

1. **使用測試按鈕**：
   - 進入群組詳情頁面
   - 點擊 "Test Live Activity" 按鈕
   - 檢查 console 日誌

2. **檢查 console 日誌**：
   - 看是否有 "✅ Successfully started Live Activity" 訊息
   - 如果有錯誤，查看詳細的錯誤訊息

3. **檢查系統**：
   - 查看 Dynamic Island 是否顯示
   - 查看 Lock Screen 是否顯示 Live Activity

### 6. 常見問題

#### "Live Activities are not enabled"
- 檢查系統設置中的實時動態開關
- 檢查 app 特定的實時動態權限

#### "Activity limit exceeded"
- 每個 app 同時只能有 1 個 Live Activity
- 先停止現有的 Live Activity

#### "Permission denied"
- 檢查 app 的通知權限
- 檢查實時動態特定權限

### 7. 調試命令

在 Xcode console 中查看：
```
✅ Successfully started Live Activity: [waypoint name]
Activity ID: [activity-id]
```

如果看到錯誤：
```
❌ Live Activity error: [error details]
Error details: [詳細錯誤]
Error type: [錯誤類型]
```

### 8. 手動測試流程

1. 創建群組
2. 添加 waypoint
3. 點擊 waypoint
4. 選擇 "Going"
5. 檢查 Dynamic Island 和 Lock Screen
6. 嘗試 "Complete" 看是否自動停止

### 9. 故障排除

如果 Live Activity 仍然不出現：

1. **重啟 app**
2. **重啟設備**
3. **檢查 Xcode 設置**：
   - Build Settings > Deployment Target >= iOS 16.1
   - 確保 Widget Extension 正確配置
4. **檢查代碼**：
   - 確保 `HitherGroupAttributes` 在兩個 target 中完全相同
   - 確保 Widget Extension 中的 `HitherGroupLiveActivity` 註冊正確

### 10. 成功指標

當 Live Activity 正常工作時，你應該看到：
- Dynamic Island 中顯示進度
- Lock Screen 中顯示詳細信息
- Console 中有成功日誌
- 完成 waypoint 時自動停止