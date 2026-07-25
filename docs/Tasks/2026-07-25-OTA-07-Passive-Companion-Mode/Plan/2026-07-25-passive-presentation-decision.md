# OTA-07 Ticket 01 — 被動同行者呈現方式決策

**Date:** 2026-07-25  
**Status:** decided

## Options compared

| | A. True overlay shell | B. Reduced existing UI |
|---|---|---|
| What | New full-screen / floating shell covering MapScreen, own chrome lifecycle | Same MapScreen + same navigation tree; hide dense chrome and show a simplified companion panel |
| Navigation tree | Same route, but second presentation shell | Same route, single screen branch |
| State | Must carefully wire through props / context | Reuses existing `useGroupState` / journey / progress hooks in place |
| Risk | Z-order fights with OverlaySheet / BottomSheet / Live Activity island; easy to drift into a second flow | MapScreen grows slightly; presentation must stay strictly read-only for team actions |
| Fit with codebase | Map already has modal overlays for settings/search — a permanent mode overlay is a new pattern | Preferences already model device-local display prefs (gather card density, Live Activity, etc.) |

## Decision

**Select B — Reduced existing UI (presentation simplification on MapScreen).**

OTA-07 is a **presentation mode**, not a second app flow or second state store. The smallest change that keeps one navigation tree and one team/user state model is:

1. Persist a device-local preference `pref.passiveCompanionMode`.
2. When on, MapScreen renders a simplified companion panel fed by the **same** gathering phase, destinations, and user-scoped progress already used by the full interface.
3. When off, the existing full MapScreen chrome is unchanged.
4. No separate navigator, no duplicate data store, no cross-device preference sync.

A “true overlay” product feel is achieved only in the UI sense (dense chrome is replaced/covered by the simplified panel); it is **not** a second shell or system floating window.

## Locked product boundaries

### Enter / exit / memory

| Event | Behaviour |
|---|---|
| Enter | User enables passive mode from Settings (device preference). Full interface may also call the same setter. |
| Exit | Persistent **切回完整介面** control; always enabled in normal, loading, empty, and error states. |
| Memory | Preference is **local to this device** (`AsyncStorage`). Default off. No server sync. |
| Cold start | After preferences hydrate, MapScreen opens in the last chosen mode. |
| Error / empty / loading | Panel still renders; content shows loading / empty / error copy; **switch-back remains tappable**. |

### Must display

- Current gathering point (or empty copy)
- Global team phase: **停留** (`staying`) / **前往中** (`en_route`) — same source as full UI (`journeyGoing` / shared navigation session)
- Next point (when known)
- Coarse **personal** progress (user-scoped; never written into team state)

### Must keep reachable

- External navigation (maps deep-link only; no implied consent)
- Help request (`need_help` quick command — explicit user tap only)
- Switch back to full interface

### Forbidden (never auto from passive mode or silence)

- Consent / safety approval
- Payment / paywall purchase
- Voting or coordination resolution
- Announcement response
- Any team-phase transition (start/end journey, complete stop) implied by remaining in passive mode

Location, movement, arrival, and progress **may** continue to be inferred automatically as they already are in the full interface; those are personal inference paths, not silent consent.

## Out of scope (unchanged from Spec)

- Separate navigation hierarchy or duplicate store
- Cross-device preference sync
- Pixel-identical design on every platform
