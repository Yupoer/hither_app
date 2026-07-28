# Google Maps `showsTransit` bridge (durable)

`react-native-maps@1.27.2` did not expose the Google transit layer. Hither adds a
minimal `showsTransit` prop via **patch-package**.

## Automated apply

- Patch file: `patches/react-native-maps+1.27.2.patch`
- `package.json` → `"postinstall": "patch-package"`
- After `npm install` / `npm ci` (with scripts), the bridge is re-applied.

## What the patch covers

### Android (paper)

- `MapManager.java` — `@ReactProp(name = "showsTransit")`
- `MapView.java` — field + `setShowsTransit` + `map.setTransitEnabled` on ready

### Android (Fabric / New Architecture — required with `newArchEnabled=true`)

- `com/rnmaps/fabric/MapViewManager.java` — `setShowsTransit` → `view.setShowsTransit`
- `RNMapsMapViewManagerInterface.java` — interface method
- `RNMapsMapViewManagerDelegate.java` — `case "showsTransit"`
- `src/specs/NativeComponentMapView.ts` + `NativeComponentGoogleMapView.ts` — prop types

### iOS Google provider

- `AIRGoogleMap.h` / `.mm` — `showsTransit` → `transitEnabled`
- `AIRGoogleMapManager.mm` — `RCT_EXPORT_VIEW_PROPERTY(showsTransit, BOOL)`

### TypeScript

- `src/MapView.tsx` — documents `showsTransit?: boolean`

## App usage

`GroupMap.tsx` passes `showsTransit: true` on Android.

## Regenerating

```bash
# After editing node_modules/react-native-maps
npx patch-package react-native-maps
```

Native rebuild is still required for the binary to include the bridged prop.
