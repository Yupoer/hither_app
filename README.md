# Hither

Hither is a mobile group rendezvous app built around a Leader–Follower model. A leader creates a group and sets an active meeting point; members join with a short group code and use a shared map to see the destination and their relative distance.

## Core Workflow

1. A leader creates a group.
2. Members join using the group code.
3. The leader sets the active meeting point and optional meet time.
4. Members view the shared destination, group state, and distance information.

## Tech Stack

- React Native + Expo + TypeScript
- Supabase for authentication, PostgreSQL, Realtime, and Row Level Security
- Apple MapKit on iOS
- Expo Location for device-location permissions and updates
- EAS Build for iOS development and production builds

## Setup

### Prerequisites

- Node.js 20 or later
- npm
- Expo Go installed on an iPhone for local development
- A Supabase project

### Clone and install

```bash
git clone https://github.com/Yupoer/hither_app.git
cd hither_app/apps/mobile
npm install
```

### Configure environment variables

Create `apps/mobile/.env` and add your Supabase project values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Do not commit `.env` or any service-role key.

### Apply database migrations

From the repository root, link the intended Supabase project and apply migrations:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

### Run locally

```bash
cd apps/mobile
npx expo start
```

Scan the displayed QR code using Expo Go on an iPhone. For iOS-native functionality that Expo Go cannot run, such as Live Activities, create and install an EAS development build.

### Run tests

```bash
cd apps/mobile
npm test
```

## Testing Path

1. Launch the app with Expo Go.
2. Complete onboarding as a Leader.
3. Create a group and copy its short group code.
4. Join the same group from a second session or test device as a Member.
5. Set an active meeting point as the Leader.
6. Confirm that the Member map displays the destination and distance state.

## OpenAI Codex and GPT-5.6 Usage

This project was built with assistance from OpenAI Codex and GPT-5.6.

### GPT-5.6

We used GPT-5.6 for architecture and product reasoning:

- Reviewed MVP scope and defined the Leader–Follower coordination model.
- Structured the React Native, Expo, Supabase, and native-platform architecture.
- Reviewed data models for groups, memberships, meeting points, and location updates.
- Refined onboarding flows, feature boundaries, UX copy, and edge cases around location permissions.

### Codex

We used Codex to accelerate implementation and validation:

- Implemented and iterated on React Native screens and Expo configuration.
- Assisted with Supabase schema migrations, data-access code, and Row Level Security policies.
- Built location and permission service abstractions for cross-platform behavior.
- Generated test scaffolding, investigated TypeScript and integration errors, and improved test coverage.

All final product, architecture, code-integration, testing, and deployment decisions were reviewed and completed by the project author.

## Current Limitations

- The primary tested development path is iOS with Expo Go.
- Native iOS capabilities such as Live Activities require an EAS development build and cannot be fully tested in Expo Go.
- Android support is planned but is not the primary validated release target.
