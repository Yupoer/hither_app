# OTA-09 Code Review

> 日期：2026-07-26  
> 結果：**未通過，任務保留於待審區**

## Findings

### [P1] coordination request lifecycle 只有 backend/service，沒有接到任何 user-facing flow

`apps/mobile/src/api/services/CoordinationRequestService.ts:197-305` 已實作 create、respond、override、deadline resolution、cancel、fetch；`apps/mobile/src/api/client.ts:85-99` 也有 export。但在 `apps/mobile/src` 內搜尋 `createCoordinationRequest`、`respondToCoordinationRequest`、`overrideCoordinationRequest`、`fetchCoordinationRequests` 的結果只有 service、client export 與 contract test，沒有 screen、component、hook 或 MapScreen 呼叫端。

因此 OTA-09 的核心 user stories 目前不可達：organizer 無法提出請求或查看 response/deadline，participant 無法選項回應，成員也看不到 resolved outcome。Supabase migration 與 service contract 通過，不代表產品功能已完成；現有 gather request UI 不能替代 OTA-09 的多選項、policy、deadline lifecycle。

**修正要求：**至少建立一個現有 MapScreen／旅程入口可達的 request list/detail/create flow，接上 realtime 或 refresh、response count/deadline、participant response、leader override／resolution outcome；補上 component/hook integration test。導航立即啟動不需被 request 阻塞，維持現有獨立路徑。

## Verification

- `npm.cmd run typecheck`：通過。
- OTA-09 lifecycle／contract targeted tests：通過；測試目前只驗證 service、migration 與 contract，未驗證任何 UI integration。
