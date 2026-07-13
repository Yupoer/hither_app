# Map UI and Personal Quick Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the requested small UI/UX adjustments while preserving the existing sheets and flows, and add one account-persisted custom quick command.

**Architecture:** Keep \`MapScreen\` as the owner of existing sheet/overlay navigation. Extend the existing profile row with a \`preferences\` JSON object for account-scoped custom-command settings, and extend the existing \`commands\` pipeline with a \`custom\` type. Replace only the final quick-command slot, leaving all other command buttons and layout positions intact.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Supabase/Postgres migrations, Jest.

---

### Task 1: Add account-scoped custom command data model

**Files:**
- Create: \`supabase/migrations/20260713000000_personal_quick_command.sql\`
- Modify: \`apps/mobile/src/types/index.ts:20-38,186-207\`
- Modify: \`apps/mobile/src/api/services/ProfileService.ts:21-38\`
- Modify: \`apps/mobile/src/state/SessionContext.tsx:125-176,239-272\`
- Test: \`apps/mobile/src/__tests__/personalQuickCommand.test.ts\`

- [ ] **Step 1: Write the failing data-shape tests**

Add tests for the pure normalizer to be introduced in \`types/index.ts\`:

~~~
import { normalizeCustomQuickCommand } from '../types';

test('normalizes a saved custom quick command and trims its fields', () => {
  expect(normalizeCustomQuickCommand({ label: ' 集合一下 ', message: ' 請回來 ' })).toEqual({
    label: '集合一下',
    message: '請回來',
  });
});

test('rejects an incomplete custom quick command', () => {
  expect(normalizeCustomQuickCommand({ label: '集合一下', message: ' ' })).toBeNull();
  expect(normalizeCustomQuickCommand(null)).toBeNull();
});
~~~

- [ ] **Step 2: Run the focused test and verify RED**

Run from \`apps/mobile\`:

~~~
npm test -- --runInBand src/__tests__/personalQuickCommand.test.ts
~~~

Expected: FAIL because \`normalizeCustomQuickCommand\` does not exist.

- [ ] **Step 3: Implement the minimum model and profile persistence**

Add these types and normalizer:

~~~
export interface CustomQuickCommand {
  label: string;
  message: string;
}

export function normalizeCustomQuickCommand(value: unknown): CustomQuickCommand | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { label?: unknown; message?: unknown };
  if (typeof candidate.label !== 'string' || typeof candidate.message !== 'string') return null;
  const label = candidate.label.trim();
  const message = candidate.message.trim();
  return label && message ? { label, message } : null;
}
~~~

Add \`CustomQuickCommand\` to \`User\`, add \`custom\` to \`CommandType\`, and add \`preferences?: { quickCommand?: CustomQuickCommand }\` to the profile patch. Update \`ProfileService.updateProfile\` to write only the validated preferences object. During \`SessionContext\` hydration and refresh, read \`row.preferences?.quickCommand\` through the normalizer and expose \`customQuickCommand\` plus \`setCustomQuickCommand\` on the session context. The setter must optimistically update the user, then call the existing profile update path; on failure restore the previous value and rethrow.

Add the migration:

~~~
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

alter table public.commands drop constraint if exists commands_type_check;
alter table public.commands add constraint commands_type_check check (type in (
  'gather','find_gathering','depart','rest','be_careful',
  'go_left','go_right','stop','hurry_up',
  'need_restroom','need_break','need_help','found_something','custom'
));
~~~

- [ ] **Step 4: Run the focused test and verify GREEN**

~~~
npm test -- --runInBand src/__tests__/personalQuickCommand.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the data-model slice**

~~~
git add supabase/migrations/20260713000000_personal_quick_command.sql apps/mobile/src/types/index.ts apps/mobile/src/api/services/ProfileService.ts apps/mobile/src/state/SessionContext.tsx apps/mobile/src/__tests__/personalQuickCommand.test.ts
git commit -m "feat: persist personal quick command settings"
~~~

### Task 2: Replace the final quick-command slot with a custom command

**Files:**
- Modify: \`apps/mobile/src/components/QuickCommandsCard.tsx:1-142\`
- Modify: \`apps/mobile/src/screens/MapScreen.tsx:1313-1319,1850-1860\`
- Modify: \`apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx:13-280\`
- Modify: \`apps/mobile/src/api/services/NotificationService.ts:41-58\`
- Modify: \`supabase/functions/send-push/messages.ts\`
- Modify: \`apps/mobile/src/i18n/index.ts\`
- Test: \`apps/mobile/src/__tests__/personalQuickCommand.test.ts\`

- [ ] **Step 1: Write the failing slot and custom-message tests**

Add pure helper tests for the final-slot replacement and the send payload:

~~~
import { commandTypesWithCustomSlot } from '../types';

test('replaces only the final role command with custom', () => {
  expect(commandTypesWithCustomSlot(['gather', 'hurry_up'])).toEqual(['gather', 'custom']);
});
~~~

Add a component-level test or helper assertion that an empty custom command renders the configured entry label and does not call \`sendCommand\` until configuration exists.

- [ ] **Step 2: Run the focused test and verify RED**

~~~
npm test -- --runInBand src/__tests__/personalQuickCommand.test.ts
~~~

Expected: FAIL because the slot helper and custom command branch do not exist.

- [ ] **Step 3: Implement the minimum custom command path**

Add \`commandTypesWithCustomSlot(commands)\` returning \`commands.slice(0, -1).concat('custom')\`. In \`QuickCommandsCard\`, read \`customQuickCommand\` and \`setCustomQuickCommand\` from \`useSession\`, render the final slot with the existing Ionicons button style, and call \`sendCommand(groupId, 'custom', customQuickCommand.message)\` only when configured. If missing, call \`onConfigureCustom\` instead. Preserve the existing role-specific command list and grid styles.

Pass \`onConfigureCustom\` from \`MapScreen\` to open a small existing \`OverlaySheet\` owned by \`SettingsOverlay\`; do not create a second navigation system. The form has two \`TextInput\`s (名稱、通知內容), trims both fields, disables save until both are non-empty, and calls \`setCustomQuickCommand\`. Keep the overlay inside the existing settings overlay component so the current sheet stack remains unchanged.

Add \`custom\` to \`sendCommand\`'s type union and to push message labeling. The push body should prefer the row \`message\`, with the existing translated fallback \`command.custom\` when absent. Add Traditional Chinese and English keys for the custom label, form title, field labels, save, and invalid input.

- [ ] **Step 4: Run the focused test and verify GREEN**

~~~
npm test -- --runInBand src/__tests__/personalQuickCommand.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the custom-command slice**

~~~
git add apps/mobile/src/components/QuickCommandsCard.tsx apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx apps/mobile/src/api/services/NotificationService.ts supabase/functions/send-push/messages.ts apps/mobile/src/i18n/index.ts apps/mobile/src/types/index.ts apps/mobile/src/__tests__/personalQuickCommand.test.ts
git commit -m "feat: add account custom quick command"
~~~

### Task 3: Apply the constrained UI layout changes

**Files:**
- Modify: \`apps/mobile/src/screens/MyTeamsScreen.tsx:80-270\`
- Modify: \`apps/mobile/src/screens/MapScreen.tsx:1170-1327,1814-1848,2530-2815\`
- Modify: \`apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx:90-230\`
- Modify: \`apps/mobile/src/components/AccountSheet.tsx:55-160\`
- Modify: \`apps/mobile/src/i18n/index.ts\`

- [ ] **Step 1: Write the failing layout-contract tests**

Add shallow/component assertions for the required user-facing labels and entries:

~~~
test('keeps both KML entry points and moves history into the gathering-point area', () => {
  const source = readFileSync(resolve(__dirname, '../screens/MapScreen.tsx'), 'utf8');
  expect(source.match(/setKmlVisible\\(true\\)/g)?.length).toBeGreaterThanOrEqual(2);
  expect(source).toContain("setOverlay('history')");
});
~~~

Also assert the Chinese account label is \`帳號\`, not \`Account\` or \`設定帳號\`.

- [ ] **Step 2: Run the focused test and verify RED**

~~~
npm test -- --runInBand src/__tests__/mapUiContracts.test.ts
~~~

Expected: FAIL because the second KML entry and final Chinese labels are not present in the current source.

- [ ] **Step 3: Implement only the requested layout changes**

In \`MyTeamsScreen\`, increase only header/list/card spacing and replace the current raw button styling with existing dark glass-compatible colors, 44px minimum targets, 16–20px radii, and pressed opacity. Keep all handlers unchanged.

In \`MapScreen\`, keep \`BottomSheet\`, \`OverlaySheet\`, section order, and existing handlers. Update the current \`memberHeadingActions\`/\`refreshLocationsButton\` styles, move the same \`highAccuracy\` switch beside refresh, add the history row inside the existing gathering-point section, and add a second KML row directly after \`addStop\` in the route overlay. The second row must call \`setKmlVisible(true)\` and reuse \`KmlImportSheet\`.

In \`SettingsOverlay\`, keep the current account and Pro callbacks but render them first as descriptive glass rows. Remove only the duplicate history trigger after the entry has moved; the history overlay and callback remain. Use the existing theme/accent values rather than new colors.

Update AccountSheet/settings i18n labels to Traditional Chinese (\`帳號\`, \`Hither Pro\`, \`管理登入方式、個人資料與帳號資訊\`) while preserving the current fields, promo flow, and close behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

~~~
npm test -- --runInBand src/__tests__/mapUiContracts.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the UI slice**

~~~
git add apps/mobile/src/screens/MyTeamsScreen.tsx apps/mobile/src/screens/MapScreen.tsx apps/mobile/src/screens/MapScreen/components/SettingsOverlay.tsx apps/mobile/src/components/AccountSheet.tsx apps/mobile/src/i18n/index.ts apps/mobile/src/__tests__/mapUiContracts.test.ts
git commit -m "feat: refine map and settings controls"
~~~

### Task 4: Full verification and handoff

**Files:**
- Verify only; no new source files unless a failing test identifies a concrete regression.

- [ ] **Step 1: Run the full test suite**

~~~
cd apps/mobile
npm test -- --runInBand
~~~

Expected: all existing and new tests pass.

- [ ] **Step 2: Run TypeScript verification**

~~~
npm run typecheck
~~~

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Review the final diff**

~~~
git diff --stat HEAD~3..HEAD
git status --short
~~~

Confirm only the feature commits contain implementation files; preserve unrelated pre-existing worktree changes and do not stage them.

- [ ] **Step 4: Commit any final test-only correction**

~~~
git add apps/mobile/src/__tests__
git commit -m "test: cover personal quick command and UI contracts"
~~~

Run the full test suite and typecheck again after this commit.

