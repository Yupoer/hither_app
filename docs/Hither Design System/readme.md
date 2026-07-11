# Hither Design System

Design system for **Hither** — an iOS app that keeps a moving group together. A leader
(the *shepherd*) sets gather points; followers (the *flock*) always see **which way** and
**how far**. The brand metaphor is the **shepherd's crook**: gather the scattered, guide
them to one place.

> **Product core:** one leader guides several followers through physical space (tours,
> field trips, large venues). People scatter. The leader periodically sets the next gather
> point; each follower sees the straight-line distance + estimated walking time to it.

## Design north star
Two feelings held in tension, on purpose:
- **Duolingo-fun** — playful, rounded, encouraging, a little sticker-y (onboarding, empty states, delight moments).
- **Apple-Maps-clean** — calm, legible, uncluttered, trustworthy when it matters (the live map + navigation).

Executed as **iOS 26 Liquid Glass** controls floating over a dark Apple-Maps navy basemap.

---

## Sources given
- `assets/reference-setlog.png` — the **art-style target** (the "SETLOG" screen): bold rounded
  display type, bright saturated accents, sticker-style emoji, dark rounded cards.
- `assets/reference-app-map.png`, `reference-app-members.png`, `reference-app-group.png` —
  the user's **actual current app** (Apple Maps + bottom sheet + members/group-code/gather-points).
  The layout of these screens is intentionally preserved; only UI/type/color evolve.
- Product brief (Chinese) describing the shepherd metaphor, roles, and core scenario.

No codebase, Figma, logo, or font files were provided — see **Caveats**.

---

## CONTENT FUNDAMENTALS
- **Language:** primary UI is **Traditional Chinese (zh-Hant)**; the app also runs Japanese
  (per the live screens). Keep copy short and spoken, not formal.
- **Voice:** warm, direct, second-person implied. Encouraging like a good guide, never bossy.
  e.g. 「把走散的夥伴，重新聚在一起」, 「還差多遠？一眼就知道」, 「通知所有隊員」.
- **Roles:** 隊長 (Leader / shepherd) and 隊員 (Follower / flock). Status verbs are terse:
  未出發, 領隊中, 已抵達, 前往集合點.
- **Numbers matter, and read as data:** `3 min · 273 m`. Time is emphasized (display face, bold),
  distance is the muted companion. Never invent precision the app wouldn't have.
- **Casing:** Latin fragments (SETLOG-style) can be lowercase/uppercase for personality; Chinese
  needs no casing. Group codes are uppercase mono-ish caps: `4WBNC7`.
- **Emoji:** yes — as **member identity** (🐑 🦊 🐰 ⚽️) and small delight accents (🚩 ⭐️ 🧭).
  Used deliberately, not decoratively sprinkled.
- **Tone examples to reuse:** 「免費版上限 4 人」 (plain, honest limits), 「拖動地圖，把大頭針對準集合地點」
  (instructional, gentle).

---

## VISUAL FOUNDATIONS
- **Theme:** dark-first. UI sits on a **navy Apple-Maps basemap** (`--map-navy #16264A`),
  with app chrome in cool near-black inks (`--ink-900 … ink-100`).
- **Accent (theme color, swappable):** default **Signal Orange `#FF6B35`** — the "gather beacon".
  Secondary **Electric Sky `#37B6FF`** (navigation), success **Grass `#4ADE80`** (arrived/go).
  The accent is one token (`--accent` + friends) — retheme by repointing it. A playful member
  palette (pink, cyan, sun, plum, sky, grass) colors avatar rings, markers, and onboarding.
- **Material — Liquid Glass:** the signature. Floating panes/pills/sheets use
  `backdrop-filter: blur + saturate`, a translucent fill, a bright top edge highlight, a
  diagonal specular sheen, and a soft ambient shadow. Tokens in `tokens/glass.css`.
  *Limitation:* CSS can't refract like true Liquid Glass; depth is faked with blur + sheen.
- **Type:** display = **Fredoka** (chunky, rounded, friendly) for headings, brand, and big
  time/distance numbers; UI/body = **Plus Jakarta Sans** (clean humanist) for everything else.
- **Corner radii:** generous. Cards `24px`, large panes/sheets `30–38px`, pills fully round.
  Icon tiles `12px`. Nothing is sharp.
- **Elevation:** on dark, depth reads through **soft ambient shadow + a colored glow** (the beacon
  feel), never white borders. Accent controls emit `--glow-accent`.
- **Shape language:** rounded rectangles + full pills. Map markers are teardrop pins with a white
  ring so they pop on the basemap; the gather point is a pulsing flag beacon.
- **Motion:** quick and springy on taps (`--ease-spring`, scale to `0.96` on press), gentle decel
  eases for surfaces/sheets. Onboarding progress uses a stretching capsule. No infinite decorative loops.
- **Hover/press:** hover lightens the fill + adds glow; press shrinks (`--press-scale`).
- **Transparency & blur:** used specifically for floating-over-map chrome (glass). Opaque `Card`
  is available when legibility over busy content matters (sheets use the *heavy* glass weight).
- **Imagery vibe:** cool navy map + warm saturated accent pops; emoji as bright focal stickers.
- **Spacing:** 4px grid; `--gutter-screen 20px` default side padding; `44px` min tap targets.

---

## ICONOGRAPHY
- **Emoji-first for identity & delight:** members and markers use emoji (🐑 🦊 🐰 ⚽️), plus
  🚩 (gather point), 🧭 (navigate), ⭐️ (leader badge). This matches both the SETLOG art target
  and the live app.
- **Functional glyphs:** the live app uses **SF Symbols** (search, expand, locate/compass, share,
  chevron, the crook glyph). SF Symbols are Apple-proprietary and can't ship here. **Substitution:**
  in the kit/cards, functional icons are stand-in Unicode/text glyphs (🔍 ⤢ ➤ ‹ ›). For production,
  keep SF Symbols on-device; for web mocks, substitute **Phosphor Icons** (rounded, multi-weight —
  the closest match) via CDN. *Flagged — no icon assets were provided.*
- **No hand-drawn brand SVGs.** The only SVGs here are the stylized basemap landmasses and the
  follower path — decorative map stand-ins, not brand marks.

---

## Foundations (Design System tab)
Colors: theme accents · member palette · neutrals. Type: Fredoka display · Plus Jakarta UI ·
type scale. Spacing: spacing scale · corner radii. Brand: Liquid Glass material.

## Components
Reusable primitives, exposed under the compiled namespace (see `check_design_system`).
- **Core:** `Button`, `IconButton`, `Card`, `Pill`, `Avatar`, `Banner`
- **Forms:** `Input`, `Switch`, `Segmented`
- **Glass:** `GlassSurface` (the Liquid Glass material slab)
- **Hither (product-specific):** `GroupChip`, `RolePill`, `MapControl`, `MemberRow`,
  `DistanceChip`, `GatherPointRow`, `ProgressDots`, `MemberMarker`

*Intentional additions:* `GlassSurface`, `GroupChip`, `RolePill`, `MapControl`, `MemberRow`,
`DistanceChip`, `GatherPointRow`, `ProgressDots`, `MemberMarker` — no source component library
was provided, so these are derived directly from the live app screens and the core product loop
(map chrome, members list, gather points, "how far / how long").

## UI kit
- **`ui_kits/hither_ios/`** — interactive iPhone kit: onboarding, map home, members sheet,
  set gather point, follower navigation. Open `index.html`.

---

## Index / manifest
- `styles.css` — global entry (import manifest only).
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`,
  `shadows.css`, `glass.css`, `motion.css`.
- `guidelines/` — foundation specimen cards (colors, type, spacing, radius, glass).
- `components/` — `core/`, `forms/`, `glass/`, `hither/` (each: `Name.jsx` + `Name.d.ts` +
  `Name.prompt.md`, one `*.card.html` per group).
- `ui_kits/hither_ios/` — the interactive app kit + `README.md`.
- `assets/` — reference screenshots (SETLOG art target + live app).
- `SKILL.md` — Agent-Skills-compatible entry point.

---

## Caveats
- **No fonts provided** → Fredoka + Plus Jakarta Sans are Google-Fonts **substitutions** for the
  reference art (loaded via CDN in `tokens/fonts.css`). Swap in real files when available.
- **No logo/brand mark provided** → the brand name is set in plain Fredoka; no mark was invented.
- **No icon assets** → SF Symbols substituted with Unicode/text glyphs (Phosphor recommended for web).
- **Liquid Glass** is approximated in CSS (no true real-time refraction).
- **Basemap** in the kit is a stylized stand-in, not real Apple Maps.
- **Theme color** is a single swappable token — Signal Orange is a default, not a mandate.
