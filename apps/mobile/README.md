# Hither Mobile (`@hither/mobile`)

React Native + TypeScript app for the Hither MVP, built with **Expo** and
**React Navigation**. This is the Phase 3 *skeleton*: navigation, types, and a
stubbed API client are in place; no real business logic, maps, or Live Activity
yet.

## Stack

- Expo SDK 52 / React Native 0.76 / React 18.3
- React Navigation (native stack)
- TypeScript (strict)
- Jest + ts-jest for unit tests

## Structure

```
apps/mobile/
├── App.tsx                 Navigation container root
├── index.ts                Expo entry point
└── src/
    ├── api/client.ts        Stub API (mock data) -> maps to hither_api endpoints
    ├── navigation/RootNavigator.tsx
    ├── screens/             Auth / Group / Map / Settings
    ├── types/               Group, User, MemberLocation, Destination (+ Coordinates, GroupState)
    └── __tests__/           Jest tests for the API client
```

Types mirror the Vapor API models in
`hither_api/Sources/hither_api/Models` (`Group`, `PublicUser`, `Coordinates`,
`ItineraryItem`, `Membership`, `GroupDetailResponse`).

## Commands

```bash
npm install      # install dependencies
npm test         # run Jest unit tests (pure TS, no native toolchain needed)
npm run typecheck # tsc --noEmit
npm start        # expo start (then press a for Android, or scan QR for iOS/Expo Go)
npm run android  # run on Android emulator/device
npm run ios       # run via Expo on iOS
npm run update:preview     # OTA → preview channel (after a channel-matched EAS build)
npm run update:production  # OTA → production channel
```

## OTA (EAS Update)

Enabled via `expo-updates` + `app.json` `updates` / `runtimeVersion` (appVersion policy).
See [docs/eas-update.md](./docs/eas-update.md). **First enablement needs a new EAS build**; then pure JS can ship with `eas update`.

`npm test` deliberately covers only the pure-TypeScript logic so it passes on
Windows without a native build. Screen/component tests can be added later with
`jest-expo`.
