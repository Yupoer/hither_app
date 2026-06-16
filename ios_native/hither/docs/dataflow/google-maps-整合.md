# Google Maps 整合 🆕

## Google Maps API 數據流

```
MapView → GoogleMapsService → Google APIs → 地圖數據/路線
```

**API 整合：**
- **Routes API**：路線計算和導航
- **Places API (New)**：地點搜尋和自動完成
- **Maps SDK for iOS**：原生地圖顯示

**數據流程：**
1. 用戶在 MapSearchBar 中輸入搜尋
2. GoogleMapsService 調用 Places API 自動完成
3. 用戶選擇地點，GoogleMapsNativeView 顯示地圖
4. 路線請求通過 Routes API 計算
5. 路線數據顯示在地圖上

**API 配置：**
- API 金鑰：`AIzaSyCx0cyeUy7O4HEdZcGSlElYJibPVT5ciZQ`
- 限制：僅允許 Routes API、Places API、Maps SDK for iOS

## Google Maps 數據模型

**Places API 回應：**
```json
{
  "predictions": [
    {
      "description": "地點描述",
      "place_id": "Google Places ID",
      "structured_formatting": {
        "main_text": "主要文字",
        "secondary_text": "次要文字"
      }
    }
  ]
}
```

**Routes API 回應：**
```json
{
  "routes": [
    {
      "legs": [
        {
          "distance": { "text": "1.2 km", "value": 1200 },
          "duration": { "text": "15 分鐘", "value": 900 },
          "steps": [
            {
              "html_instructions": "轉向指示",
              "distance": { "value": 100 },
              "duration": { "value": 60 }
            }
          ]
        }
      ]
    }
  ]
}
```
