# 集合點狀態、路線與抵達通知整合規格

## 核心行為

- 「已抵達」只在該集合點的共同行程啟用後出現；隱藏時集合點倒數填滿空間。
- 隊員在行程前顯示「向隊長發送要求開始」，行程中顯示灰色、不可點擊的「前往中」。
- 個人抵達採穩定樂觀狀態，寫入失敗才回復，不得在完成前閃回「開始」。
- `request_start` 沿用 commands 與 follower request 偏好，只通知隊長。
- iOS transit 使用既有 Google Routes 幾何；Apple Maps 外部導航維持 `dirflg=r`。
- 所有交通模式在 maps boundary 使用約 10 公尺容差簡化折線。
- 首次成功抵達只通知本人；取消後再次抵達可再通知，通知失敗不阻止抵達。

## 發布邊界

- 提交 migration 與 Edge Function，但本次不部署正式 Supabase。
- 不執行 OTA、原生 build 或商店提交。
- iOS／Android 地圖、路線與本地通知需真機驗證後才能標記平台通過。
