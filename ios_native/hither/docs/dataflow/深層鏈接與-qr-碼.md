# 深層鏈接與 QR 碼

## URL 方案：`hither://join`

**格式：**
```
hither://join?code=ABC123&name=Group%20Name
```

**流程：**
1. 使用深層鏈接 URL 生成 QR 碼
2. 原生相機應用掃描 QR 碼
3. iOS 使用深層鏈接打開 Hither 應用
4. ContentView 處理 URL 並顯示加入確認
5. 用戶確認並加入群組
