# Production iOS compatibility review, 2026-11-03

The `reviewed_compatibility` record admits the reviewed source against the
working production OTA baseline without asserting the native binary's source.
The reviewed application source is
`0071f09e30889a4dc318486f816c934296271f06`. Its mobile application and native
inputs match `074d36caa40dd2cb9b316351560426ac29cc398a`; the intervening change
updates CI and CD tooling.

## Observations and limits

- App Store Connect independently displayed version `0.1.13`, build `79`,
  verified and testing, recorded here as `IN_BETA_TESTING`. Its displayed upload
  time was 2026-10-24 01:36 local. The
  [observed Build 79 metadata](https://appstoreconnect.apple.com/teams/89fd665e-7444-423e-8030-22904111c4c1/apps/6790314569/testflight/ios/1ea905d0-ef0e-448b-bd22-7d67c6c7ec47/metadata)
  does not establish its Git source.
- The operator confirms the installed latest native build and OTA are
  `0.1.13`. This is an operator compatibility attestation. The binary source
  remains unknown, so `binarySourceSha` is `null`.
- EAS readback identified production OTA group
  `7f48919c-657c-44b0-9414-a8978bee8393`, runtime `0.1.13`, source
  `017bf952db09c353ae7b14984d941be8c584fa30`, on the active unconditional
  `production` branch. That source is `comparisonBaselineSha`, not a claim
  about Build 79's source.

No device acceptance or exact Build 79 IPA inspection is claimed. This review
does not prove that a device has executed the candidate JavaScript.

## Reviewed differences

The existing conservative classifier finds exactly these seven mobile paths
outside its ordinary source and test allowlist. The record pins each path's
baseline and reviewed Git blob SHA. A `null` baseline blob means the file is
absent at the comparison baseline.

| Path | Compatibility finding |
| --- | --- |
| `apps/mobile/modules/hither-location/ios/HitherLocationModule.swift` | The only executable change selects `liveUpdates(.default)` directly. The baseline selects `.fitness` only for activity type 3 and accuracy at least 5. The current production caller uses activity type 1 and accuracy 3 or 4, so the baseline also selects `.default`. No bridge export, argument, result or event changes. |
| `apps/mobile/modules/hither-location/ios/LocationDeliveryPolicy.swift` | Removes that unused fitness-selection predicate. Delivery timing behavior is unchanged. |
| `apps/mobile/package.json` | Adds only the `check:quick` tooling script. Dependency and devDependency maps are equal, and `package-lock.json` is unchanged. |
| `apps/mobile/src/native/backgroundLocation.ts` | Uses existing background methods and location events. The baseline Swift already declares and emits `onBackgroundLocationError`. Health reporting and owner selection execute in JavaScript. |
| `apps/mobile/src/native/location.ts` | Uses the installed Expo location API, including its existing watch error callback. Ordinary accuracy selection and health reporting need no new native method. |
| `apps/mobile/src/native/locationSourceHealth.ts` | A new JavaScript state and listener collection. It imports no native module. |
| `apps/mobile/src/native/maps.ts` | Adds a JavaScript availability check using the existing native module and JavaScript proxy circuit state. It calls no new native method. |

`backgroundLocationOptions` in
`apps/mobile/src/state/backgroundJourneyController.ts` owns the activity and
accuracy values used by the sole production `startBackgroundLocation` call.
The two baseline Swift blobs also match their versions at `8319632`, before
Build 79's upload. This establishes the reviewed bridge comparison, not the
unobserved binary provenance.

The gate still requires the exact checkout, baseline ancestry, matching app and
embedded iOS runtime, app version, production channel and evidence. It accepts
only the listed path set and exact blob pairs. A later native, dependency,
configuration, asset or wrapper change requires a new compatibility review.
Publication retains the separate successful master CI, current-master,
backend-attestation, active-route, retained-intent and remote-readback guards.
