# 05 — 完成純 UI inventory 與 SafePressable 收斂

**What to build:**

完成 back、cancel、dismiss、retry、tab、segmented、backdrop 等純 UI 入口的 inventory，並收斂 `SafePressable` 的使用策略：正式導入到需要它的 production 入口，或移除未使用的 abstraction。

**Blocked by:** 01 — Action timeout、retry 與 stale-result 防護；03 — 完成 Map／Sheet 高風險入口遷移；04 — 完成帳務、feedback 與診斷操作遷移

**Status:** ready-for-agent

- [ ] 主要 button-like interaction 100% 出現在 inventory
- [ ] 純 state setter 保持最小 safe handler，不加入不必要 wrapper
- [ ] 會觸發 navigation、IO 或 native call 的入口通過共用 action contract
- [ ] `SafePressable` 有 production caller 且用途明確，或被刪除
- [ ] contract tests 能防止新增未盤點的高風險 async handler

