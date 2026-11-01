# Store and Premium

A traveler opens the store, earns or spends Tokens, or purchases a Premium entitlement. Visible benefits follow authoritative verification rather than an ad-close event or a client purchase callback alone.

## Sub-features

- `store-open` opens Store from the actual Map and returns an entitlement change to the parent.
- `store-reward` waits for SSV before changing the wallet.
- `store-redeem` confirms redemption and updates both wallet and group entitlement.
- `store-premium` selects a plan, purchases, restores, or enters a promo through the actual controls.
- `store-native-events` handles purchase, ad, notification, and Live Activity external receipts at their production boundaries.

## How to get to it (user POV)

- Open Store from Map, then choose the rewarded ad or a product redemption.
- Choose Subscribe from Store or an applicable Premium gate, select a monthly, annual, or trip plan, and purchase.
- Open Restore or the promo entry in Premium.

## Driving it with World

Preconditions:

- Doctor passes. Use the exact wallet, product catalog, signed-purchase fixture, and SSV preconditions in `headlessStoreScenario.test.ts`.
- The recorded Tokyo trip does not exercise Store. Keep this feature unexecuted until its own cases run.

- **Parent Map entry.** Run `node test/headless/run.cjs --testNamePattern="MAP-STORE-01" --json --outputFile="$verifySuiteOutput"` with a fresh suite path from the map index. The actual Map store case must wait for SSV and an entitlement refresh before the parent tools control unlocks.
- **Store and Premium controls.** Run `node test/headless/run.cjs --testNamePattern="mounted Store and Premium scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. The suite drives `store-ad-cta`, `store-redeem-team_extra_points_3`, and `premium-presentation-purchase`, plus plan, restore, promo, and preference controls. Assert the visible wallet or entitlement alongside fixture ledger rows. `iap.finishTransaction` must follow server verification.
- **External events.** Run `node test/headless/run.cjs --testNamePattern="external-only Store/native scenarios on" --json --outputFile="$verifySuiteOutput"` with a fresh suite path. Capture external receipts and resulting provider state when using those events in a new scenario.

## Gotchas

- An earned or closed ad is not an SSV credit. The existing case keeps the wallet unchanged until `creditReward` models that independent external response.
- A purchase fixture is not a real StoreKit or Play receipt. Actual payment, refund, restore, promo, signing, and backend deployment remain external acceptance.
- Store mounted directly reports a parent callback receipt. It does not prove Map's entitlement refresh. The `MAP-STORE-01` integration is a distinct required entry.
- If a plan, wallet balance, verification token, or entitlement prerequisite is absent, report failure and record the missing precondition here. Do not grant the entitlement directly to make its UI pass.
