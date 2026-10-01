# UI lifecycle pressure checks

Background location, member location sharing, essential navigation and backend
sync keep their existing schedules. Inactive/background UI releases map and
decorative canvases, stops display clocks and animations, and retains form drafts.
Android blur pauses UI while its AppState can still be active. Foreground resume
reads current wall time/state once; missed display ticks are never replayed.

Local executable checks:

```text
cd apps/mobile
npm test -- --runInBand foregroundUiStress foregroundSheetLifecycle
node --expose-gc scripts/pressure-foreground-ui.cjs 300
```

The standalone pressure run executes actual route display projection, route
trimming, marker duration and particle movement functions. Its fixed workload is
2,000 route points, 100 marker samples and 12 arrays of 78 particles. AppState is
simulated in 500 ms cycles with 300 ms active and 200 ms idle. Reported CPU,
memory and recent-operation p95 describe **Node on the host**, not iPhone rendering.
Timing samples are bounded to 4,096; resources must reach zero at shutdown.
Jest separately stresses 200 lock/resume cycles with 12 concurrent canvases and
12 display clocks and checks suspended timers, duplicate resume and retained drafts.

## Native acceptance (required to confirm thermal/frame targets)

Use a compatible release binary, physical iPhone, and the native diagnostic
switch enabled with consent. Record OS, app build, device model, power mode and
ambient conditions. Keep personal coordinates/names out of shared results.

1. Start from thermal `nominal`; run for at least 30 minutes with a populated
   member map, long route, gathering cards and normal navigation/location sharing.
   Capture native frames continuously with Instruments or equivalent tooling;
   sparse one-second diagnostic samples alone cannot certify the entire run.
   Review the first five minutes separately as well as the full run.
2. Alternate card expansion, map pan/zoom, route editor and Settings. Leave
   unsaved form text in place, lock/unlock repeatedly, and resume from another app.
   Include at least five minutes of lock/background and verify another member
   still receives location updates and necessary navigation remains available.
3. Include an interval playing audio and switching to other applications. On
   return, verify the latest route/member data, retained form drafts/camera, and
   no animation/time catch-up or duplicate callbacks.
4. Inspect native CPU/memory/frame windows, thermal transitions, and optional
   workload counts. Background optional map/canvas work must be zero; location
   and sync frequency must match the unchanged configuration. After repeated
   resumes, live resources/memory must settle without increasing per cycle.
5. Pass only when thermal remains `nominal` throughout and every foreground
   native measurement window has `slowFrameRatio <= 0.05`. Exclude intentionally
   absent background frame windows rather than reporting them as zero FPS loss.
   Any warmer state or excess slow frames fails acceptance and needs native
   profiling. Node/Jest results cannot certify these device targets.
