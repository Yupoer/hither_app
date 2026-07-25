# OTA-05 匿名同行者與註冊門檻 Spec

## Problem Statement

匿名同行者的文件與 UI 仍有 3 天與 14 天不一致的描述，server 也沒有統一的 expiry cleanup。另一方面，匿名 Leader 可以直接建立大型旅團，導致大型旅程規則與帳號責任不一致。

## Solution

統一匿名同行者的使用期限為 14 天，client 與 server 使用同一個 expiry。匿名帳號可建立或加入最多 5 人旅團；在第 6 人加入前，要求 Leader 完成註冊並保留原有 UID、membership 與旅團關聯。

## User Stories

1. As an anonymous companion, I want to use the trip for 14 days, so that a normal travel period does not expire unexpectedly.
2. As an anonymous companion, I want to see when my access will expire, so that I can register before losing access.
3. As an anonymous user, I want to join a group of up to 5 people, so that a small trip can start without registration friction.
4. As an anonymous leader, I want to know before adding the sixth person that registration is required, so that I can complete the gate before the group grows.
5. As an anonymous user who registers, I want to keep my UID, memberships, and trip data, so that registration does not create a second identity.
6. As a product operator, I want expired anonymous access cleaned up consistently, so that stale access does not remain active on one client.

## Implementation Decisions

- The authoritative anonymous expiry is 14 days and is stored with the anonymous identity or membership according to the existing account model.
- Client messaging and server authorization use the same expiry timestamp and timezone-independent comparison.
- Anonymous users may create or join trips up to 5 total members, including the leader.
- Adding member number 6 or higher requires the Leader to register before the membership mutation is accepted.
- Registration upgrades the existing identity and preserves UID, memberships, trip data, and valid local state.
- Expiry cleanup is idempotent and must not delete a registered identity that was upgraded from anonymous access.

## Testing Decisions

- Test expiry at just before, at, and just after 14 days.
- Test anonymous membership counts at 5 and 6 total members, including the Leader.
- Test the sixth-member gate for anonymous and registered Leaders.
- Test registration upgrade preservation of UID, membership, trip data, and entitlement references.
- Test cleanup retries and repeated cleanup without duplicate deletion or state corruption.
- Reuse existing auth, anonymous account, group membership, and server expiry contract tests.

## Out of Scope

- Changing the 5-person Free Plan or Premium pricing.
- Anonymous access beyond the 14-day window.
- Forced registration before joining a group of 5 or fewer.
- Migration of unrelated legacy accounts.

## Further Notes

The 14-day rule is the product decision. Any remaining 3-day copy is stale documentation or UI and must be removed as part of this task.
