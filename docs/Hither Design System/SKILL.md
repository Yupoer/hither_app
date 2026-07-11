---
name: hither-design
description: Use this skill to generate well-branded interfaces and assets for Hither (an iOS app that keeps a moving group together — a leader sets gather points, followers see which way and how far), either for production or throwaway prototypes/mocks. Contains design guidelines, colors, type, fonts, Liquid Glass materials, assets, and a full iOS UI kit for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill first — it is the design guide and manifest.
Then explore the other files as needed:
- `styles.css` + `tokens/` — the CSS custom properties (colors, type, spacing, radius, shadows,
  Liquid Glass material, motion). Link `styles.css` to inherit everything.
- `components/` — reusable React primitives (Core, Forms, Glass, Hither-specific). Each has a
  `.prompt.md` with a usage example.
- `ui_kits/hither_ios/` — a full interactive iPhone kit (onboarding, map, members sheet, set
  gather point, follower nav) built from the components.
- `guidelines/` — foundation specimen cards.
- `assets/` — reference screenshots.

Design north star: **Duolingo-fun meets Apple-Maps-clean**, expressed as iOS 26 **Liquid Glass**
controls floating over a dark navy basemap, with the Fredoka display face + a swappable accent
(default Signal Orange). Primary UI language is Traditional Chinese.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create
static HTML files for the user to view. If working on production code, copy assets and read the
rules here to design as an expert in this brand.

If the user invokes this skill without other guidance, ask what they want to build, ask a few
focused questions, and act as an expert designer who outputs HTML artifacts or production code.
