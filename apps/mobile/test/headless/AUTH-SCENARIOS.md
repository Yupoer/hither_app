# Authentication execution map

`src/__tests__/headlessAuthScenario.test.ts` mounts actual app screens and providers. Every scenario runs with the iOS and Android module resolvers. Google uses the actual native iOS adapter and the actual Android hosted callback adapter. Only external SDK, transport, navigation, clock and OS boundaries use fixtures.

The table maps operation families to executed scenario assertions. A registered operation alone is not execution evidence. A family can share a scenario with another family.

| Family | Scenario and observable assertions |
| --- | --- |
| A01 | `validates credentials locally...` checks trimmed email, credential-error feedback, preserved drafts, disabled duplicate submission, password visibility while busy and committed identity plus RoleSelect on success. |
| A02 | `separates signup confirmation...` checks mismatched confirmation cannot submit, verification-required signup stays signed out and writes no profile. `rejects duplicate and missing signup identities...` checks duplicate and missing auth-user errors, then immediate registration reaches RoleSelect with no invented nickname or profile. |
| A03 | `validates credentials locally...` switches signup and signin while preserving the email draft. |
| A04 | `validates credentials locally...` blurs invalid email and whitespace password, checks field feedback and zero auth requests, then checks editing clears the server credential error. Signup also rejects mismatched confirmation. |
| A05 | `validates credentials locally...` reveals and hides the password and verifies reveal is disabled during email sign in. Signup reveals the unmatched confirmation field through its actual toggle. |
| A06 | `cancels social sign in...` checks cancellation has no exchange or session, missing iOS token has no exchange, exchange network failure, platform adapter selection, successful profile write and RoleSelect. `reports Google profile failures...` checks profile network error and 12 second profile timeout on both platforms, plus iOS token-exchange timeout. Late responses do not navigate. |
| A07 | `cancels Apple...` checks OS cancel, missing identity token, raw nonce in auth exchange, full-name metadata and profile persistence, session display name and RoleSelect. The native fixture validates the SHA256 nonce sent to Apple. |
| A08 | `separates signup confirmation...` enters reset mode through the real forgot-password control. |
| A09 | Same scenario checks malformed email is disabled, failed transport does not show sent feedback, success trims email and uses the recovery callback, and the 60 second resend cooldown blocks duplicate requests. |
| A10 | Same scenario checks signup resend failure permits retry, successful resend starts a 60 second cooldown, and only the expected signup/email payload reaches transport. |
| A11 | Same scenario uses pending-back and reset-back controls and checks the password draft survives. |
| A12 | `opens and cancels guest warning...` checks the real confirmation control appears while session remains null. |
| A13 | Same scenario checks confirmation changes the route exactly after 100 milliseconds and creates no anonymous account. |
| A14 | Same scenario checks cancel removes confirmation and leaves session null. |
| A15 | `opens only configured HTTPS legal URLs...` checks absent configuration produces no Linking call and configured terms/privacy controls open the exact respective URLs. |
| A16 | `validates callback boundaries...` rejects wrong protocol/origin/path/state, duplicate state/code, token query fields, fragments, error responses and expiry. It accepts and consumes one recovery code and rejects replay. `handles deep-link callbacks once...` drives actual Linking listeners, checks same-URL single flight, ignores another simultaneous code and proves failed exchanges consume the transaction before another delivery. |
| A17 | `validates callback boundaries...` mounts actual PasswordRecoveryScreen after accepted recovery, blocks whitespace and mismatched passwords, reveals password, retains form/recovery after update failure, and changes the server auth password only on success. |
| A18 | Same scenario checks recovery success remains for 1199 milliseconds and clears at 1200 milliseconds. |
| A19 | `creates and joins through lazy anonymous auth...` blocks empty inputs, rejects anonymous auth failure without group creation, trims nickname/group name, blocks duplicate create, verifies durable membership and Map navigation, sanitizes invite input, preserves existing membership after invalid code, renames the current guest and joins without another anonymous sign in. |
| A20 | `restores durable identity...` observes local identity before held profile enrichment, then enrichment after the deferred hydration clock, and restores the same persisted account in another process. `boots the real navigator...` completes actual onboarding skip, restarts the full App, checks Login when signed out, RoleSelect after login and cold restore, and protected-route removal after signout. |
| A21 | `restores durable identity...` checks startup has no duplicate initial refresh, transient foreground failures retain identity, retry boundaries occur at 2 and 4 seconds, successful recovery stops retry, and terminal refresh invalidates identity without another retry after 30 seconds. |
| A22 | `cancels registered signout...` checks cancel produces no auth signout, failure retains identity, retry resets Login and clears membership/Premium/native activities, and registered signout preserves the backend account. `deletes an anonymous identity during signout...` verifies anonymous signout deletes its auth user/profile. |
| A23 | `deletes an anonymous identity during signout...` drives actual AccountSheet delete confirmation. Cancel produces no deletion, server failure retains account and suppresses completion callbacks, and success removes auth/profile/memberships and invokes close/deleted exactly once. |
| A24 | `drops team Premium on leave...` starts with authoritative personal and team Premium, fails the null-group projection request and checks local membership/trip/team access clear while personal Premium and account identity survive. Backend membership remains because this operation clears current session selection. |

These are function and state proofs. They do not establish native UI layout, physical-device sign-in dialogs, delivery of real email, production OAuth configuration, real Supabase policy enforcement or physical background execution. The table does not claim exhaustive coverage of every timeout, account-switch race or platform SDK failure permutation listed in the source inventory.

Run the scenario suite from `apps/mobile` with `node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath src/__tests__/headlessAuthScenario.test.ts`.

Validation after the upstream refactor merge used an isolated `npm ci --include=dev --ignore-scripts` installation matching the current lockfile. The full run passed 31 of 32 cases. Its only failure was the iOS full App cold import exceeding the former 20 second presentation boot deadline before a functional assertion. After the shared host adopted a bounded 60 second presentation boot deadline, the affected full App scenario passed on both iOS and Android at `1a83c6f`. All 32 distinct authentication cases therefore passed across these runs. `tsc --noEmit` also passed at that revision. The metadata self-check confirmed all 16 scenario patterns exist and map A01 through A24 to both platforms.
