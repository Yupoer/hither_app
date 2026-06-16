# 深層鏈接與 URL 方案

## 自定義 URL 方案：`hither://`

**支持的 URL：**
- `hither://join?code=ABC123&name=Group%20Name`

**處理：**
1. AppDelegate/SceneDelegate 捕獲 URL
2. ContentView.onOpenURL 處理深層鏈接
3. 提取參數並顯示加入確認
4. GroupService 處理實際加入流程
