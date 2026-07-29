# Code Review 01

固定基準：`origin/master@bbda1ff5d8c478b935f9bf3396b45aae87869699`

## Standards

最初 review 發現兩個判斷型 smell：未使用的 `localRouteThis` 資料鏈，以及 leader-only 分支重複。兩者已刪除／合併。收件人純函式也已移至 `recipients.ts`，避免通知文案模組同時承擔路由責任。

最終未發現硬性 Standards 違規。真機與 Supabase 部署驗證仍是 release gate，未宣稱平台通過。

## Spec

最初 review 發現三項：

1. arrival RPC 成功後若刷新失敗仍會 rollback。
2. 取消抵達尚未成功就提前清除通知去重。
3. `request_start` 收件人與偏好只有字串 contract，缺少可執行測試。

修正後：

- rollback 只發生於 arrival RPC 寫入失敗；刷新失敗保留樂觀抵達。
- 取消 RPC 成功後才清除抵達與通知去重狀態。
- `requestStartRecipientIds` 的 Deno test 驗證只回傳隊長，並驗證 `follower_requests` 偏好欄。

最終未發現剩餘 Spec finding。

總計：Standards 0、Spec 0；裝置與正式 Supabase 驗證仍待 release gate。
