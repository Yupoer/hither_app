const scenario = (inventory, pattern, assertions) => ({ inventory: inventory.split(','),
  file: 'src/__tests__/headlessMapControlsScenario.test.ts', pattern, platforms: ['ios', 'android'], assertions });

module.exports = [
  scenario('MAP-MEMBER-01', 'actual presence persists solo', 'Real platform status selection persists solo and notification macros. Stealth cancel preserves location consent. Accepted stealth disables sharing. Follow never silently reenables sharing.'),
  scenario('MAP-MEMBER-02', 'actual split warning precedes membership', 'The warning precedes subgroup writes. Confirm creates the actor subgroup and refreshed merge control. Merge restores main scope and removes the empty subgroup.'),
  scenario('MAP-MEMBER-02', 'actual pending invitation decline', 'Decline removes only its invitation without changing membership. Accept waits for the warning then persists its subgroup and refreshes the member controls.'),
  scenario('MAP-MEMBER-03', 'actual leader kick confirmation', 'No self-kick button exists. Cancel keeps both members. Confirm removes only the chosen peer from backend and rendered roster.'),
  scenario('MAP-GROUP-01', 'actual invitation copies and shares', 'The actual invitation overlay sends the current code to clipboard and platform Share while retaining membership.'),
  scenario('MAP-PROFILE-01', 'actual Map profile saves trimmed', 'The Map avatar opens the real editor. Save persists the trimmed identity, updates the real session and requests a group projection refresh before closing.'),
  scenario('MAP-SETTINGS-01', 'actual Map group avatar save', 'The actual settings child saves the chosen group avatar and refreshes its durable projection. Followers have no group-avatar editor.'),
  scenario('MAP-GROUP-02', 'actual Map home preserves membership', 'Leave cancellation retains both members. Home resets RoleSelect without leaving. Reentry and confirmed departure remove only the acting follower.'),
  scenario('MAP-GROUP-02', 'actual Map signout cancellation', 'Cancel retains identity. Confirm signs out through the real Map callback and resets Login without deleting the registered account.'),
  scenario('MAP-TOOLS-01', 'actual tools entitlement gate', 'Locked Live Activity cannot enable. Passive mode retains consent and survives process restart. Actual exit restores the map.'),
  scenario('MAP-STORE-01', 'actual Map Store waits for SSV', 'Client reward does not credit. Explicit server verification credits the wallet. Real Map redemption calls its parent entitlement refresh so the Tools Live Activity control unlocks and persists.'),
  scenario('MAP-LOC-01,MAP-LOC-02,MAP-LOC-03,MAP-LOC-04', 'actual fresh samples drive location', 'Platform-owned fresh fixes upload actual coordinates. Locate and fit issue native camera commands. Team refresh requests the actual peer roster and a second attempt preserves server cooldown.'),
  scenario('MAP-LOC-06', 'actual sharing reenable refuses', 'Denied permission keeps consent disabled. A later permitted confirmation persists sharing and restarts the real tracking path.'),
  scenario('MAP-LOC-07', 'actual Map hands active navigation', 'Actual Map Start and AppState handoff select the supported iOS native owner or Android Expo task. Real background callbacks upload with the active session. Disabling sharing stops both owners without ending the team session.'),
  scenario('MAP-SHELL-01,MAP-SHELL-02,MAP-SHELL-03,MAP-SHELL-04,MAP-SHELL-05', 'actual pane guards carousel', 'Invalid and current indices preserve pane ownership. Carousel drives actual camera framing. Card activity resets the ten-second collapse deadline. Pending place cancel removes its controls without writing.'),
  scenario('MAP-OPS-01', 'actual exception actions persist', 'Actual help exception acknowledge, resolve and reopen persist local handling through process restart without changing peer state or team journey.'),
  scenario('MAP-SETTINGS-02', 'actual reset cancellation preserves tours', 'Cancel keeps completed tours. Confirm clears account tour flags and durably requests onboarding replay while staying on Map. The development archive button is absent.'),
  scenario('MAP-TOUR-01', 'actual route tour previous next', 'Real native measurement permits Next and Previous. Completing all route steps persists account completion and suppresses the tour after process restart.'),
];
