# Hither Mobile (`@hither/mobile`)

React Native + TypeScript app for the Hither MVP, built with **Expo** and
**React Navigation**. Native capabilities such as background location, mobile
ads, notifications, and Live Activity require the iOS development build; Expo
Go is reserved for JavaScript fallback smoke tests.

## Stack

- Expo SDK 56 / React Native 0.85 / React 19.2
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
npm start             # Expo Go for JS fallback smoke tests
npm run dev:client    # Development build / iOS device with Fast Refresh
npm run android       # run on Android emulator/device
npm run ios           # run via Expo on iOS
npm run update:preview     # OTA → preview channel (after a channel-matched EAS build)
npm run update:production  # OTA → production channel
```

### iOS development build

Use a development build for native capabilities such as mobile ads, background
location, notifications, and Live Activity. Expo Go does not contain this
project's native modules.

```bash
npx eas build --profile development --platform ios
npx expo start --dev-client
```

Install the EAS internal-distribution build on the iPhone or iPad, then open
Hither from the QR code shown by `expo start`. JavaScript and TypeScript changes
use Fast Refresh. Rebuild the development client after changing native modules,
config plugins, permissions, Expo/RN versions, or native code.

Expo Go remains useful for checking JavaScript fallbacks:

```bash
npx expo start --go --clear
```

## OTA (EAS Update)

See [docs/eas-update.md](./docs/eas-update.md). **First enablement needs a new EAS build**; then pure JS can ship with `eas update`.

`npm test` deliberately covers only the pure-TypeScript logic so it passes on
Windows without a native build. Screen/component tests can be added later with
`jest-expo`.
