# Store and native operation evidence

`operations-store.cjs` exports executable operations, automatic lifecycle entries, and a scenario-to-family map. Its 23 scenario patterns cover W01–W17, B01–B08, B10–B12, N01–N16, and L01–L09. B09 belongs to the account/provider scenarios. Mapping is a review index. Passing Jest assertions provide execution evidence.

The mounted scenarios use the real PreferencesProvider and SessionProvider. StorePane, PremiumPresentation, NotificationPreferencesCard, QuickCommandsCard, PremiumPurchaseRecovery, notification subscriptions, and LiveActivityRuntime execute their production code. NativeObservers renders the actual resource elements returned by the notification hooks. It observes AppNotice state through the production subscription.

Only external boundaries are substituted. Purchases use fake expo-iap events for the selected platform. Ad earned events enter verification and cannot grant tokens. The separate backend SSV input grants the wallet. A held purchase verification proves native finish cannot happen before a durable grant. Consumable trip purchases bind their group and finish as consumable. Notification assertions distinguish durable server notification intents, local native schedule requests, and foreground AppNotice state.

Run both suites from apps/mobile.

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/headlessStoreScenario.test.ts src/__tests__/headlessStoreNativeScenario.test.ts
```

The post-master run used upstream ca5f1b8 with integration 97a52a5 and the scenario changes recorded at bdf12f0. It passed 52 of 54 cases. The two account-switch cases exposed an external auth fixture that persisted a session without emitting the SDK event. Integration 1a08557 corrected that boundary. The targeted pair then passed after advancing the production zero-delay auth hydration timer. That final test content is recorded at 9b121bd.

The valid result is 54 passing cases across the full run and the affected-case rerun. It is not a claim that the original full run was green. Reports are in test-results/headless-store-postmaster.json and test-results/headless-store-account-switch.json in the Store worktree. TypeScript checking passed on the new baseline. Dependencies were installed privately from the new lockfile with all four existing patches applied.

These assertions do not run Swift/Kotlin, native drawing, OS scheduling, real StoreKit/Play, real advertising SSV, APNs/FCM, or Supabase SQL/RLS. AppNotice subscription state does not prove the app renders a visible notice. Physical-device behavior remains separate.
