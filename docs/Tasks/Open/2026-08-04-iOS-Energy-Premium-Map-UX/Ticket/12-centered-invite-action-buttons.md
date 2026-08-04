# 12 — 修正邀請按鈕 Padding 與文字中心

**What to build:** 讓邀請成員區的分享與複製按鈕保有一致左側留白，且文字不受 icon 寬度影響，永遠以整顆按鈕的幾何中心置中。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 分享與複製 icon 固定在按鈕左側 16pt inset，不貼住邊界。
- [ ] label 以整個 button bounds 置中，而不是只在 icon 剩餘空間內置中。
- [ ] 分享與複製按鈕使用相同 layout contract、hit target 與 loading／disabled 行為。
- [ ] 中英文、動態字級、iPhone 窄寬與 iPad 寬版下，icon 與文字不重疊、不裁切。
- [ ] VoiceOver label、role 與 action 保持可用，視覺調整不建立第二個 press target。
- [ ] layout／snapshot 測試直接驗證 icon inset 與文字幾何中心。
