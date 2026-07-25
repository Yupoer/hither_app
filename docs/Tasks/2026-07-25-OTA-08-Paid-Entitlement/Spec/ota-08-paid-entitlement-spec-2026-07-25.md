# OTA-08 正式收費與權益 Spec

## Problem Statement

目前付費狀態主要由 client 判斷，Paywall 會直接寫入 Pro 狀態，Free 方案的人數與行程點限制也沒有由 server authoritative enforcement。這會造成使用者看到的方案、實際可用權益與付款結果不一致。

## Solution

建立正式的 Free Plan 與 Small Trip Premium Pass 權益模型。Free 方案包含最多 5 人（含 Leader）與每個 itinerary 5 個點；2–5 人旅程可購買 7 天 Small Trip Pass。兌換碼沿用既有 promo code 流程直接授權，不另建立獨立的 Early Access 功能層。

StoreKit／Play Billing 的交易由 BUILD-02 提供；OTA-08 負責 Paywall、方案限制、server entitlement、交易結果接收與兌換碼授權。

## User Stories

1. As a trip organizer, I want to see the Free Plan limits, so that I know what the trip can use without payment.
2. As a trip organizer, I want to buy a 7-day Small Trip Pass for a 2–5 person trip, so that the trip can use premium capacity for the trip duration.
3. As a trip organizer, I want entitlement to be bound to a trip, so that another trip cannot accidentally consume the same pass.
4. As a trip organizer, I want the app to restore my valid purchase, so that reinstalling or changing devices does not lose access.
5. As a user with a valid redemption code, I want to enter it and unlock the granted entitlement, so that special access does not require a separate product mode.
6. As a user, I want expired, refunded, or revoked access to stop working, so that the displayed plan matches the authoritative server result.
7. As a trip organizer, I want a clear reason when a member or itinerary point exceeds the Free limit, so that I know what action is needed.

## Implementation Decisions

- The server is authoritative for member-count limits, itinerary-point limits, entitlement status, start time, and expiry time.
- Free capacity counts the Leader in the total member count; the limit is 5 people.
- Small Trip Premium Pass is limited to 2–5 people, is trip-scoped, and expires 7 days after activation.
- Client entitlement state is a cache and must not grant access when the server reports expired, revoked, refunded, or invalid.
- Promo code redemption is an authorization path inside the same entitlement model; there is no separate Early Access product state.
- Paywall must not write a Pro flag directly as proof of payment.
- Native purchase and restore calls are supplied by BUILD-02; OTA-08 consumes verified purchase outcomes and maps them to server entitlements.
- The unresolved 6–20 person commercial plan is out of this task; no large-trip paywall is added until its product boundary is decided.

## Testing Decisions

- Test observable plan limits at 4, 5, and 6 total members, with the Leader included in the count.
- Test itinerary limits at 5 and 6 points.
- Test entitlement activation, valid use, expiry, refund, revocation, duplicate transaction, and repeated redemption.
- Test reinstall or device change by restoring a server-valid entitlement rather than trusting local storage.
- Test that invalid or expired server responses remove premium access from the UI.
- Reuse existing service, RPC, purchase contract, and Paywall contract test patterns; do not test internal storage implementation details.

## Out of Scope

- Implementing StoreKit or Play Billing native modules; that belongs to BUILD-02.
- A separate Early Access unlock mode or token currency.
- Pricing or feature limits for trips with more than 5 people.
- Rewarded ads that grant Premium capacity or Premium days.

## Further Notes

The release cannot claim real paid purchase support until OTA-08 and BUILD-02 are both complete. Android Play Billing remains subject to emulator-only validation until Android real-device access is available.
