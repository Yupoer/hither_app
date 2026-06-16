# Firebase 集合

## 🆕 **v2.1 架構更新**
為了提升擴展性與效率，數據模型已重構。原有的 `members` 陣列已被移除，改用 `members` 子集合來儲存每個成員的獨立資訊。

## 1. 群組集合 (`/groups/{groupId}`)
**用途:** 儲存不常變動的群組靜態資訊。
**文檔結構：**
```json
{
  "id": "UUID-字符串",
  "name": "群組名稱",
  "leaderId": "用戶ID字符串",
  "createdAt": "Firebase 時間戳",
  "inviteCode": "6位字母數字邀請碼",
  "inviteExpiresAt": "Firebase 時間戳 (創建後24小時)",
  "isActive": true
}
```

## 2. 成員子集合 (`/groups/{groupId}/members/{userId}`)
**用途:** 儲存經常變動的成員動態資訊。每個成員都是此子集合下的一份獨立文件。
**文檔結構：**
```json
{
  "userId": "用戶ID字符串",
  "displayName": "用戶顯示名稱",
  "role": "leader" | "follower",
  "joinedAt": "Firebase 時間戳",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "lastLocationUpdate": "Firebase 時間戳"
}
```

**關鍵字段：**
- 群組集合: 儲存群組基本資訊，不包含成員陣列
- 成員子集合: 每個成員都是獨立文件，支援更高效的位置更新
- `location`: 成員的即時位置座標
- `lastLocationUpdate`: 位置最後更新時間
