# 02 — Background watchdog 與 native crash evidence

**What to build:** 建立可重現、可分段的 background journey timeline，釐清 watchdog、SIG11、SIG10 是否有共同 native 根因，再以最小修改降低超時與記憶體壓力。

**Blocked by:** 01 — 先固定 Realtime/session lifecycle baseline，再量測背景工作

**Status:** partial — client evidence hooks shipped; device profiling open

- [x] 對每次 background callback 記錄 allow-listed elapsed time：location/config load、AsyncStorage write、diagnostics、outbox flush、Live Activity update、session ack。
- [x] crash class 區分 helper（react_render / watchdog / sig11 / sig10）與 Jest contract。
- [ ] 以 MetricKit build/device/time correlation 分離 watchdog、SIG11、SIG10；對 SIG11/SIG10 取得 symbolicated stack。
- [ ] 在 iPhone13,3 / iOS 26.5.2 同級 release-like device 重現 10 秒 watchdog 場景；另覆蓋 Android background location path。
- [x] 檢查 background task start/stop 是否重複、callback 是否重入，並確認 session version 更新不會重新啟動 controller（code review + ticket 01 stable deps；待實機確認）。
- [ ] 只有在 timeline 證明必要時，才將可合併的儲存/telemetry 寫入合併或移出 critical callback；不得改變 arrival、outbox、Live Activity、session ack semantics。
- [ ] Acceptance：背景 callback 不超過 watchdog budget；無新增 duplicate energy end；crash report 能指出 operation stage、build、device 與 symbolicated native frame。

**Response:** Client-side `timeBackgroundStage` + `background_op_timeline` diagnostics and `classifyCrashClass` landed. No semantic change to ack/outbox/LA. Device symbolication and release profiling remain.
