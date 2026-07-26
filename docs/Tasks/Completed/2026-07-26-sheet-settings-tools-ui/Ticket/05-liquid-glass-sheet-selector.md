# 05 — Apply Liquid Glass to the main sheet selector

**What to build:** The main Members, Route, and Tools selector uses the existing native Liquid Glass surface on supported iOS versions while preserving the same three-way interaction, accessibility semantics, and functional fallback everywhere else.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The main sheet selector still dispatches selection changes for Members, Route, and Tools and retains its sliding selected indicator and locked-option behavior.
- [ ] Every option keeps its accessibility label plus selected and disabled state.
- [ ] Supported iOS 26 devices render this selector through the existing Liquid Glass capability boundary.
- [ ] Older iOS, Android, and unsupported environments render the existing functional fallback.
- [ ] Liquid Glass styling is scoped to the main sheet selector; shared segmented controls used by Settings remain unchanged.
- [ ] No SwiftUI bridge, native target, navigation control, or dependency is added.
- [ ] Selector contract coverage verifies all three choices, disabled behavior, accessibility state, fallback, and call-site scoping.
- [ ] A supported-iOS check confirms native material rendering, an unsupported-platform check confirms fallback behavior, and the mobile TypeScript typecheck passes.
