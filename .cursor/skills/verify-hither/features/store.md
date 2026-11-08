# Store and Premium

A traveler opens the store, earns or spends Tokens, or purchases a Premium entitlement. Visible benefits follow authoritative verification rather than an ad-close event or a client purchase callback alone.

## Sub-features

- `store-open` opens Store from the actual Map and returns an entitlement change to the parent.
- `store-reward` waits for SSV before changing the wallet.
- `store-redeem` confirms redemption, debits the wallet, and grants the chosen personal or team entitlement.
- `store-premium` selects a plan, purchases, restores, or enters a promo through the actual controls.
- `store-native-events` handles purchase, ad, notification, and Live Activity external receipts at their production boundaries.

## How to get to it (user POV)

- Open Store from Map, then choose the rewarded ad or a product redemption.
- Choose Subscribe from Store or an applicable Premium gate, select a monthly, annual, or trip plan, and purchase.
- With no active Premium, open Premium from Map Settings for Restore or promo. Store Subscribe omits those controls.

## Driving it with World

Preconditions:

- Doctor passes. Use the exact wallet, product catalog, signed-purchase fixture, and SSV preconditions in `headlessStoreScenario.test.ts`.
- The recorded Tokyo trip does not exercise Store. Keep this feature unexecuted until its own cases run.

- **Parent Map entry.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runInBand --runTestsByPath src/__tests__/headlessMapControlsScenario.test.ts --testNamePattern="MAP-STORE-01 actual Map Store waits for SSV and redemption refresh unlocks the parent tools control" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. Require one iOS and one Android case. The wallet stays at nine Tokens until fixture SSV, then displays ten. After confirmed personal Live Activity redemption, check the fixture debit and the enabled control in parent Map Tools.
- **Store and Premium controls.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="mounted Store and Premium scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The suite drives `store-ad-cta`, `store-redeem-team_extra_points_3`, and `premium-presentation-purchase`, plus plan, restore, promo, and preference controls. Assert the visible wallet or entitlement alongside fixture ledger rows. `iap.finishTransaction` must follow server verification.
- **External events.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="external-only Store/native scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Capture external receipts and resulting provider state when using those events in a new scenario.
- **Account and Premium parent entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual App Map Store entry points on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Start real App and enter Map through My teams. Exercise anonymous Store registration, Store monthly purchase, locked Tools annual purchase, Store trip pass, Settings promo, and Settings Restore. Hold purchase verification and require the parent to remain locked with an unfinished transaction, then verify actual Paywall dismissal and the refreshed Map benefit. Trip purchase must bind the exact group and remain separate from personal Premium. Settings must finish dismissing before its Paywall opens. Invalid promo retains its input; valid promo closes the code form while leaving the parent Paywall open until the user dismisses it. Destination quota prompts are separate entry points in the [itinerary map](itinerary.md).

## Gotchas

- An earned or closed ad is not an SSV credit. The existing case keeps the wallet unchanged until `creditReward` models that independent external response.
- Purchase fixtures prove App behavior with a supplied verification result. The checked-in [purchase verifier](../../../../supabase/functions/verify-and-apply-purchase/index.ts) expects a StoreKit JWS and has no Google Play token path. Verify real payment, restore, promo, refund, and backend deployment separately.
- Store mounted directly reports a parent callback receipt. It does not prove Map's entitlement refresh. The `MAP-STORE-01` integration is a distinct required entry.
- If a plan, wallet balance, verification token, or entitlement prerequisite is absent, record the failure and missing precondition in the run notes. Do not grant the entitlement directly to make its UI pass.
