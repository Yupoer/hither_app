# OTA-09 協調請求 Spec

## Problem Statement

目前 gather request 主要是 Leader approve／reject，無法表達變更集合點、時間、路線或行程時的參與者意見、期限與逾時結果。導航啟動不應被投票阻塞，但真正需要共同決策的變更需要可追蹤的結案規則。

## Solution

建立獨立的協調請求生命週期：提出請求、收集回應、到期結案、套用結果。每個請求包含主題、選項、期限、resolution policy 與 default outcome；未回覆保持未回覆，不視為同意或拒絕。請求不影響立即啟動的導航 session。

## User Stories

1. As a trip organizer, I want to propose a change to a gathering point, time, route, or itinerary, so that the group can make a deliberate decision.
2. As a participant, I want to choose one of the offered options, so that my response is recorded separately from my technical navigation state.
3. As a participant, I want to leave a request unanswered, so that silence is not treated as consent or rejection.
4. As a trip organizer, I want to see the current response count and request deadline, so that I know whether to wait or intervene.
5. As a trip organizer, I want a request to close atomically at its deadline, so that the outcome is not different across devices.
6. As a group member, I want a resolved request to show its final outcome, so that I know which itinerary state is authoritative.
7. As a trip member, I want navigation to start immediately without a coordination request, so that a vote cannot block an urgent departure.

## Implementation Decisions

- A request has `subject`, `options`, `deadline`, `policy`, `defaultOutcome`, `status`, and `resolvedOutcome`.
- Participant responses are separate from technical states such as tracking, offline, permission, or arrival.
- Supported policies must include at least organizer override, unanimity, majority, and timeout default; the product may initially expose a subset.
- The server performs deadline resolution atomically and rejects responses after closure.
- A resolved itinerary change is applied as a new authoritative operation with versioning; it does not mutate history silently.
- Starting navigation remains an immediate action and does not create or wait for a coordination request.

## Testing Decisions

- Test request creation, valid response, response change before closure, duplicate response, and response after closure.
- Test each policy at zero, partial, unanimous, and conflicting responses.
- Test deadline resolution on multiple clients and verify one authoritative outcome.
- Test that no response is interpreted as consent or rejection.
- Test that navigation start remains available while a request is open.
- Reuse existing gather request, itinerary version, and realtime contract test patterns.

## Out of Scope

- General chat or free-form polling.
- Voting to start navigation.
- AI-generated options or recommendations.
- Cross-trip requests or organization-wide workflow.

## Further Notes

OTA-09 is a coordination layer over the existing itinerary and gathering-point model. It must not become a second source of truth for the active gathering state.
