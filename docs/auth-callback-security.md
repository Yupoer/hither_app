# HTTPS authentication and installation revocation

The controlled origin is `https://hither-legal.pages.dev`, served by the existing
Cloudflare Pages project `hither-legal`. Production deployment
`7aa769ef-8d68-4f38-b06b-78b83489aaa1` on 2026-10-02 serves the associations and
recovery pages from commit `db81bbce84db0de2daac0df5bd6925778a439ccd`.
The existing privacy and terms content was preserved byte-for-byte.

The HTTPS browser fallback preserves recovery for older binaries that lack
associated domains. Both callback and recovery pages accept only an implicit
recovery fragment marked `type=recovery`, clear the URL immediately, keep the
access token only in memory, and update the password directly through Hither's
Supabase Auth endpoint using the project's public publishable key. No token is
stored or forwarded to a custom scheme. Success asks the user to sign in again
in Hither. Signup confirmation clears credentials and asks the user to return
to the app. The browser never exchanges PKCE codes without the originating
device's verifier. Pages use no-store/no-referrer and a CSP allowing only local
scripts/styles and the exact Supabase connection origin.

The app accepts only `/auth/callback` or `/auth/recovery` at that origin, with
a matching, unexpired locally stored transaction state and a single PKCE code.
Custom-scheme callbacks, bearer tokens, foreign origins, unsolicited recovery,
duplicate parameters and replay are rejected. Email recovery and signup must
finish on the device that initiated them. Native Google/Apple ID-token login
and password login retain their normal flows. `EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN`
can override the origin for a different controlled deployment.

Before releasing a compatible binary:

1. Run `scripts/configure-auth-links.ps1` with the controlled HTTPS origin and
   the Android production signing certificate's SHA-256 fingerprint. It writes
   the iOS entitlement and the hosted AASA/Android assetlinks files. The existing
   iOS team (`5LBPG5TUKP`) and bundle (`app.hither.mobile`) are taken from the
   checked-in native project. On 2026-10-02, the existing EAS `production`
   profile's default build credential `Mz1CbzauHK` reported SHA-256
   `2B:9D:A7:37:F8:F2:D8:86:F8:98:9F:4C:AA:04:73:84:94:36:83:91:D1:58:D2:D4:E9:74:E1:33:C7:BA:03:52`.
   The checked-in Android association uses that actual certificate. If Google
   Play App Signing uses another certificate, add its public SHA-256 before
   claiming verified links for a Play-distributed binary.
2. Deploy `apps/legal-site` to that same origin, preserving the `.well-known`
   directory and `_headers`; verify that both association URLs return the JSON
   files with `application/json`, not a fallback HTML page. The checked-in AASA
   already targets the existing default origin's iOS app. The Android file must
   be generated using the actual release certificate.
3. Run `scripts/configure-auth-urls.ps1` after public HTTPS deployment verification.
   It checks source readback before PATCHing only Supabase Auth
   `site_url` and `uri_allow_list`; do not rerun the SMTP configuration script.
   Retain unrelated HTTPS redirects, remove `hither:`/`exp:` entries, and allow the two HTTPS
   paths with the state query. The existing confirmation/recovery email templates
   use `.ConfirmationURL`, so they preserve the PKCE challenge and redirect.
   The site URL is `https://hither-legal.pages.dev/auth/callback`; denied old
   custom-scheme redirect requests safely fall back there for browser recovery.
4. Build the binary with the native associated-domains entitlement and Android
   verified HTTPS intent filter. Validate email signup/recovery and Android hosted
   Google login/linking on real devices, including cold launch. This cannot be
   completed by an OTA update to a binary lacking those associations.

Production readback on 2026-10-02 verified both association URLs as HTTP 200
`application/json`, with exact source contents. The canonical callback/recovery
pages and recovery module return HTTP 200 with the expected CSP, no-store and
no-referrer headers. Bare callback/recovery paths return HTTP 308 to their
canonical trailing-slash pages and preserve the state query.

After those checks, Supabase Auth was changed to the HTTPS site URL above and
the two HTTPS state-bearing redirects. All 241 unrelated Auth/SMTP/OAuth fields
were compared and remained unchanged. Invalid-token verification requests
confirmed that `hither://auth/recovery` and the former
`exp://192.168.0.191:8081` redirect fall back to HTTPS, while an allowed HTTPS
recovery redirect preserves its state. Supabase still accepts a loopback
`exp://127.0.0.1:8081` redirect; this is not an assertion that every local URL is
blocked. The mobile handler independently requires the exact HTTPS origin and
pending state. No emails were sent. This proves
hosting and server configuration; native link delivery still requires the
compatible binary and real-device validation described above.

`20261002061707_revoke_installation_capabilities.sql` adds installation IDs to
normal push and per-activity tokens. Logout/account transitions wait for in-flight
registration writes, block queued writes, and revoke the current installation
atomically while the old session is still available. Unbound legacy push rows
were revoked during migration; the upgraded app registers its installation
again. Legacy activity sessions are matched by this device's native activity IDs.
Other accounts and
other installations remain intact. A database transaction lock and revoked
session record prevent late registration with the old session. Failed revocation
throws and leaves auth available for an explicit retry. Successful signout is
local to this session; it no longer revokes other devices' authentication.

Local checks:

```
cd apps/mobile
npm test -- --runInBand src/__tests__/authCallbackSecurity.test.ts src/__tests__/installationCapabilities.test.ts
node ../../supabase/tests/installation_capabilities_regression.mjs <pglite/dist/index.js>
node ../../scripts/auth-web-recovery-check.mjs
```

The SQL regression executes the functions/triggers and checks current-device
cleanup, other-device/account retention, replay, fresh-session registration and
privileges. PGlite is local PostgreSQL proof, not concurrent production or real
device acceptance. The JS regression checks registration-versus-revocation
ordering and account transitions with explicit actors.
