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

## Development and release workflow

Hither uses local review and direct `master` delivery for solo development. A GitHub Issue is optional. A PR is not a routine delivery step.

1. Check `origin/master`, the current branch, existing worktrees, and uncommitted files. Use a task worktree based on the latest remote `master` when other work is in progress. Preserve unrelated changes and stashes.
2. Implement the task, inspect the complete diff, and review behavior, data access, permissions, compatibility, accessibility, and tests. Fix findings locally. Run the affected package and CI checks, including the applicable acceptance map and changed-function coverage. Do not rerun an unchanged valid result.
3. Confirm that the task branch contains only reviewed work. Push a `deliver/<task>` branch without a PR and wait for its `ci-required` result. The branch CI checks the whole task diff against `origin/master`, including the full acceptance map. Fix failures on the same branch and rerun the affected local review.
4. Check that the reviewed branch still starts from the current remote `master`. If `master` moved, integrate it into the task branch and rerun affected checks and CI. Fast-forward a clean local `master` to the passing task commit, then push normally. Confirm the remote SHA and its `master` CI result. A failed post-push CI requires a new reviewed fix and another passing run. Never reset or force-push another owner's work.
5. For a requested full iOS product release, pin the delivered SHA. Compare all changes since the binary and latest successful update actually in use. Deploy and verify any required Supabase migration or Function before publishing dependent app code. Documentation-only and backend-only changes need no app update.
6. If every app change is compatible with the installed production binary, publish an iOS `production` OTA from a clean checkout of that SHA and verify its update group, runtime, channel, and source. If native code, dependencies, permissions, plugins, entitlements, or another compatibility gap requires a binary, use the established `mac-codex` Mac handoff and full Release validation. [CD iOS TestFlight](.github/workflows/cd-ios-testflight.yml) is an additional manual cloud path on `master`: dispatch it with the reviewed 40-character `source_sha` and choose `preflight`, `build-only`, or `submit`. Only `submit` uploads; both build modes require an existing `EXPO_TOKEN` Actions secret and access to EAS signing and App Store Connect credentials. The cloud path has not yet demonstrated a signed build, the [full Release cold-launch check](docs/ios-release-startup-validation.md), Apple processing readback, or physical-device acceptance. Its `preflight` checks the runner and dependencies only. Verify the production privacy/terms URLs, Xcode 27 app lifecycle compatibility, and the remaining release checks before treating a cloud build as delivered. Keep the same source SHA throughout. Do not publish an extra OTA for a binary-only release.
7. Report Git, CI, backend, OTA or TestFlight, and physical-device results separately. `uploaded` and `processing` do not mean the build is installable. Clean up only task-owned resources after confirming that no unshipped work remains.

The release entry is `C:/Users/alexs/.codex/skills/hither-release/SKILL.md`. It uses `Publish-HitherMaster.ps1` for reviewed-path commits and pushes and retains `Invoke-HitherMacRelease.ps1` for the validated Mac handoff. The manual cloud workflow is available for separate validation; its successful branch CI does not establish a successful TestFlight release. A Git-only request stops after Git verification. OTA-only and build-only requests keep their stated limits. A plain commit or push does not start a release.

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
