# Live Activities (iOS 16.1+)

## ActivityKit 整合

**功能：**
- 鎖屏距離顯示
- Dynamic Island 整合
- 實時位置更新
- 電池高效更新

**實現：**
```swift
struct ActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let distance: Double
        let lastUpdate: Date
        let leaderName: String
    }
    
    let groupName: String
    let groupId: String
}
```
