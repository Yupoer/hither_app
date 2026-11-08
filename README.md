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

Hither uses local review. A GitHub Issue is optional. PR delivery and direct `master` delivery each require one premerge CI run and a postmerge `master` run.

1. Check `origin/master`, the current branch, existing worktrees, and uncommitted files. Use a task worktree based on the latest remote `master` when other work is in progress. Preserve unrelated changes and stashes.
2. Implement the task, inspect the complete diff, and review behavior, data access, permissions, compatibility, accessibility, and tests. Fix findings locally. Run the affected package and CI checks, including the applicable acceptance map and changed-function coverage. Do not rerun an unchanged valid result.
3. Confirm that the task branch contains only reviewed work, then push a `deliver/<task>` branch. If there is a PR, review it and wait for its merge-result `ci-required` check. Without a PR, manually dispatch the CI workflow on that `deliver/` branch and wait for `ci-required`; it checks the whole task diff against `origin/master`, including the full acceptance map. A `deliver/` push alone does not start full CI. Fix failures on the same branch and rerun the affected local review.
4. Check that the reviewed branch still starts from the current remote `master`. If `master` moved, integrate it into the task branch and rerun affected checks and CI. After an approved PR passes, merge it; for direct delivery, fast-forward a clean local `master` to the passing task commit and push normally. Confirm the remote SHA and its `master` CI result. A failed postmerge CI requires a new reviewed fix and another passing run. Never reset or force-push another owner's work.
5. For a requested full iOS product release, pin the delivered SHA. Compare all changes since the binary and latest successful update actually in use. Deploy and verify any required Supabase migration or Function before publishing dependent app code. Documentation-only and backend-only changes need no app update.
6. If every app change is compatible with the verified production binary, publish an iOS `production` OTA from the reviewed SHA and verify its update group, runtime, channel, and source. For a new binary, follow the [Mac release procedure](docs/ios-cd-release.md#build-on-the-mac-by-default) from that same SHA. Build the signed IPA once, verify it, and check [Release startup](docs/ios-release-startup-validation.md) before uploading that IPA to TestFlight. Reuse valid startup evidence for the same source and configuration. Select a [cloud native mode](docs/ios-cd-release.md#native-build-and-testflight) only when cloud build or validation was requested. A binary-only release needs no extra OTA.
7. Report Git, CI, backend, OTA or TestFlight, and physical-device results separately. `uploaded` and `processing` do not mean the build is installable. Clean up only task-owned resources after confirming that no unshipped work remains.

The release entry is `hither-release`. A Git-only request stops after Git verification. OTA-only and build-only requests keep their stated limits. A plain commit or push does not start a release.

The [iOS CD release routes](docs/ios-cd-release.md) describe the verified-binary OTA gate, retained native modes, and checks required after publication.

### Local quick checks and CI scope

From `apps/mobile`, run `npm run check:quick -- --base origin/master` for existing changed-file ESLint and the whole-project TypeScript check. The command includes branch commits, staged, working, and untracked changes. Shared lint/configuration changes run the existing full lint inputs. It does not install dependencies or run tests; use the existing test commands for affected behavior.

Product PRs select complete CI jobs through the module-contract planner. Known mobile changes run `verify` and `mobile-checks`; backend, native, shared, and unknown changes retain full checks. Product pushes to `master` and every manual dispatch run all gates. Markdown-only push/PR changes skip product jobs except for the formal location sync skill's canonical and wrapper entries. `verify` owns metadata, the single full Node invocation, changed-function coverage, scenarios, and sanitized evidence. Its location sync model and real-source replay run for mapped owners and formal skill changes, and in every full run. Unrelated selective changes skip formal verification. `mobile-checks` owns the component, lint, typecheck, runtime, Expo, and auth-web bundle.

Optional manual `benchmark=true` dispatches collect worker and real installed-cache pairs alongside full normal CI. `benchmark_kind` selects `workers`, `cache`, or `all`. Benchmark success does not replace `ci-required`. Adoption requires five matching pairs on each runner environment to pass correctness and satisfy `max(candidate) < min(baseline)`; overlapping results retain the incumbent. Worker plain and coverage modes are evaluated separately.

Worker plain mode binds its base to the checked-out `HEAD` and still runs all Node tests. Coverage mode accepts the optional `benchmark_coverage_base` input as a real 40-character commit SHA. Its preflight rejects an empty eligible coverage scope. Source changes require new matching worker measurements before adoption.

Installed dependency-tree reuse is disabled for all CI jobs pending Bun-specific evidence on each runner. Historical npm [cache benchmark run 41339472235](https://github.com/Yupoer/hither_app/actions/runs/41339472235) had five passing Ubuntu pairs with separate timing ranges. Median clean install time was 20.1s, compared with 9.6s for cache restore. The `macos-26` and `xcode-27` ranges overlapped. These npm measurements do not establish a benefit for the current Bun install path.

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
