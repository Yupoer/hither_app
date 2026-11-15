# Store and Premium

A traveler opens the store, earns or spends Tokens, or purchases a Premium entitlement. Visible benefits follow authoritative verification rather than an ad-close event or a client purchase callback alone.

## Sub-features

- `store-open` opens Store from the actual Map and returns an entitlement change to the parent.
- `store-reward` waits for SSV before changing the wallet.
- `store-redeem` confirms redemption, debits the wallet, and grants the chosen personal or team entitlement.
- `store-premium` selects a plan, purchases, restores, or enters a promo through the actual controls.
- `store-native-events` handles purchase, ad, notification, and Live Activity external receipts at their production boundaries.

## How to get to it (user POV)

- On Android, expand Map and choose Store. Claim the ad reward or confirm a product redemption there.
- On iOS, open the Map avatar to enter You. Claim the reward there, or choose Store for redemptions and inline Premium plans, Restore, and promo.
- Android Store Subscribe and the locked Tools control open Premium plans. When Premium is inactive, open it from Map Settings to access Restore and promo. The Store Subscribe sheet omits those controls.

## Driving it with World

Preconditions:

- Doctor passes. Use the exact wallet, product catalog, signed-purchase fixture, and SSV preconditions in `headlessStoreScenario.test.ts`.
- The recorded Tokyo trip does not exercise Store. Keep this feature unexecuted until its own cases run.

- **Map reward and redemption.** Run `./test/headless/run.ps1 -Driver jest -ResourceReport "${verifySuiteOutput}.resources.json" --runInBand --runTestsByPath src/__tests__/headlessMapControlsScenario.test.ts src/__tests__/headlessD6YouScenario.test.ts --testNamePattern="MAP-STORE-01 actual Map Store waits for SSV and redemption refresh unlocks the parent tools control|shows verified coin balance from You to Shop and keeps restore and promo entry on the shop" --json --outputFile="$verifySuiteOutput"` with a fresh result path. Require the Android Map case and the iOS You case. Both start with nine Tokens and show ten only after fixture SSV. Confirm the personal Live Activity redemption and check the debit and entitlement. Android also enables the control in Map Tools. iOS shows a zero balance and the owned item in Store; this case does not drive the You Live Activity toggle.
- **Store and Premium controls.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="mounted Store and Premium scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The suite drives `store-ad-cta`, `store-redeem-team_extra_points_3`, and `premium-presentation-purchase`, plus plan, restore, promo, and preference controls. Assert the visible wallet or entitlement alongside fixture ledger rows. `iap.finishTransaction` must follow server verification.
- **External events.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="external-only Store/native scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Capture external receipts and resulting provider state when using those events in a new scenario.
- **Account and Premium parent entries.** Run `./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --testNamePattern="actual App Map Store entry points on" --json --outputFile="$verifySuiteOutput"` with a fresh result path. The suite enters the saved team from App and drives registration, monthly and annual plans, the trip pass, promo, and Restore. On iOS, Store shows the resulting entitlement inline. On Android, wait for Settings to dismiss before its Paywall opens and check that verified purchases dismiss it. Keep the transaction unfinished until fixture verification. An invalid promo keeps the input. A valid promo closes the code form and leaves the plans available. A trip pass must bind the exact group without granting personal Premium. For quota prompts, see the [itinerary map](itinerary.md).

## Gotchas

- An earned or closed ad is not an SSV credit. The existing case keeps the wallet unchanged until `creditReward` models that independent external response.
- Purchase fixtures prove App behavior with a supplied verification result. The checked-in [purchase verifier](../../../../supabase/functions/verify-and-apply-purchase/index.ts) expects a StoreKit JWS and has no Google Play token path. Verify real payment, restore, promo, refund, and backend deployment separately.
- A standalone Store mount proves its callback receipt. Use the Map or You scenario to check that the parent shows the updated benefit.
- If a plan, wallet balance, verification token, or entitlement prerequisite is absent, record the failure and missing precondition in the run notes. Do not grant the entitlement directly to make its UI pass.
