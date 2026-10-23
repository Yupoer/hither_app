const assert = require('node:assert/strict');

const screen = 'src/screens/MapScreen.tsx';
const component = name => `src/components/${name}.tsx`;
const panel = name => `src/screens/MapScreen/components/${name}.tsx`;
const source = (file, symbol) => [{ file, symbol }];
const press = (app, testId, within) => app.host.call({ kind: 'press', testId, ...(within ? { within } : {}) });
const text = (app, testId, value) => app.host.call({ kind: 'changeText', testId, value });

const operations = {};
function operation(name, inventory, file, symbol, input, completion, run, level = 'screen') {
  assert(!operations[name], `Duplicate map operation ${name}`);
  operations[name] = { entry: `${file}::${symbol}`, level, input, completion, inventory,
    sources: source(file, symbol), run };
}
function button(name, inventory, symbol, testId, completion, file = screen) {
  operation(name, inventory, file, symbol, '{}', completion, app => press(app, testId));
  operations[name].sources = source(file, testId);
}
function identifiedButton(name, inventory, symbol, prefix, key, completion, file = screen) {
  operation(name, inventory, file, symbol, `{ ${key}: string }`, completion, (app, input) => {
    assert.equal(typeof input[key], 'string');
    return press(app, `${prefix}${input[key]}`);
  });
  operations[name].sources = source(file, prefix);
}

operation('map.tab', ['MAP-SHELL-01', 'MAP-SHELL-05'], screen, 'selectSheetPane',
  '{ index: number }', 'The real platform tab callback selects the mounted pane; invalid/current indices preserve selection.',
  (app, { index }) => app.host.call({ kind: 'nativeEvent', testId: 'sheet-pane-tabs', value: app.platform === 'ios'
    ? { event: 'onSelectionChange', nativeEvent: { index } }
    : { event: 'onChange', nativeEvent: { selectedSegmentIndex: index } } }));
button('map.search.open', ['MAP-DEST-14', 'Q01'], 'sheetHeader search AmicroButton', 'map-search',
  'Real AmicroButton completion opens DestinationSearch and retains its open-complete busy barrier.');
operation('map.search.query', ['Q01', 'Q02', 'Q04'], component('DestinationSearch'), 'onChangeText',
  '{ value: string }', 'Normalized query enters the actual 450 ms effect; results remain owned by its current sequence.',
  (app, { value }) => text(app, 'place-search-query', value));
operation('map.search.pick', ['MAP-DEST-01', 'Q03'], component('DestinationSearch'), 'handlePick',
  '{ resultKey: string }', 'Actual result press awaits Map pick. Editors stage a confirm card; followers persist a leader suggestion.',
  (app, { resultKey }) => press(app, `place-search-result-${resultKey}`));
operation('map.pin.drop', ['MAP-DEST-02'], component('GroupMap'), 'onLongPress',
  '{ latitude: number, longitude: number }', 'Native map event enters real coordinate guard and stages the dropped-pin card and camera command.',
  (app, { latitude, longitude }) => app.host.call({ testId: 'group-map-native', kind: 'nativeEvent',
    value: { event: 'onLongPress', nativeEvent: { coordinate: { latitude, longitude } } } }));
operation('map.place.rename', ['MAP-DEST-03'], screen, 'setPendingPlaceTitle',
  '{ value: string }', 'Actual controlled title changes before confirmation and favorite identity resolution.',
  (app, { value }) => text(app, 'confirm-place-name', value));
button('map.place.cancel', ['MAP-DEST-13', 'Q06'], 'dismissConfirmCard', 'confirm-place-cancel',
  'Pending place, title, source and keyboard clear without a destination write.');
button('map.place.pool', ['MAP-DEST-03', 'MAP-DEST-04', 'MAP-DEST-05'], 'confirmAddPlace', 'confirm-place-pool',
  'Real confirm guard trims/falls back title, persists pool stop or suggestion, and clears only successful current context.');
button('map.place.first-stop', ['MAP-DEST-03', 'MAP-DEST-04'], 'confirmAddPlace(firstStop)', 'confirm-place-quick-add',
  'First-stop placement uses real trip-day selection, quota and duplicate-write guards.');
button('map.place.favorite', ['MAP-DEST-10', 'F02', 'F04'], 'togglePendingFavorite', 'add-place-favorite-star',
  'Optimistic normalized star toggle reaches owner-scoped real favorite service and rolls back on failure.');
button('map.place.center', ['MAP-DEST-02'], 'confirm-place center onPress', 'add-place-center-btn',
  'Center command uses the staged coordinates without persisting a point.');

for (const [field, id] of [['title', 'coordinate-name'], ['latitude', 'coordinate-latitude'], ['longitude', 'coordinate-longitude']]) {
  operation(`map.coordinates.${field}`, ['Q05'], component('CoordinateDestinationSheet'), id,
    '{ value: string }', 'Real coordinate form draft changes; no persistence before validation and submit.',
    (app, { value }) => text(app, id, value), 'component');
}
button('map.coordinates.submit', ['Q05'], 'handleSubmit → onSubmit', 'coordinate-submit',
  'Real validation rejects empty/range/nonfinite inputs and awaits caller; failure retains fields and success closes.', component('CoordinateDestinationSheet'));
button('map.coordinates.cancel', ['Q06'], 'onClose', 'coordinate-cancel',
  'Cancel closes the actual coordinate form without invoking submit.', component('CoordinateDestinationSheet'));

button('map.route.open', ['MAP-ROUTE-01'], 'route edit AmicroButton', 'map-edit-itinerary',
  'Actual edit action captures main scope; the real overlay synchronizes once per open session.');
button('map.route.open-subgroup', ['MAP-ROUTE-01'], 'route edit AmicroButton', 'map-edit-itinerary-subgroup',
  'Actual edit action captures subgroup scope and retains dirty draft ownership.');
button('map.route.favorites', ['MAP-DEST-12'], 'favorites onPress', 'route-favorites',
  'Real route child sheet displays current owner favorites.', component('DestinationReorderList'));
identifiedButton('map.route.favorite.pick', ['MAP-DEST-12'], 'favorite onPress → onPickFavorite', 'route-favorite-', 'favoriteId',
  'Actual list selection creates one draft pool stop for editor, or the real follower suggestion path.', component('DestinationReorderList'));
identifiedButton('map.route.favorite.delete', ['MAP-DEST-11', 'F03'], 'favorite delete onPress → onDeleteFavorite', 'route-unfavorite-', 'favoriteId',
  'Real Map caller optimistically removes the exact favorite and restores its captured snapshot on failure.', component('DestinationReorderList'));
identifiedButton('map.route.move.open', ['MAP-ROUTE-12'], 'Row.onMoveTo', 'route-move-', 'destinationId',
  'Actual row opens move-to-day selection from current destination.', component('DestinationReorderList'));
operation('map.route.move.day', ['MAP-ROUTE-02', 'MAP-ROUTE-03', 'MAP-ROUTE-12'], component('DestinationReorderList'), 'moveToDay',
  '{ day: number | null }', 'Actual list constructs full reorder payload; active target rejects pool and Map preserves closed slots, meet clocks and drafts.',
  (app, { day }) => press(app, `route-move-day-${day ?? 'pool'}`));
identifiedButton('map.route.delete', ['MAP-ROUTE-08'], 'Row.delete → MapScreen.handleDelete', 'delete-', 'destinationId',
  'Real confirmation decides cancellation versus persisted delete and navigation causality.', component('DestinationReorderList'));
identifiedButton('map.route.select', ['MAP-ROUTE-12'], 'toggleMultiSelect', 'route-select-', 'destinationId',
  'Actual selected IDs change and bulk delete receives that captured selection.', component('DestinationReorderList'));
identifiedButton('map.route.emoji.open', ['MAP-ROUTE-09', 'MAP-ROUTE-12'], 'openEmojiPicker', 'route-emoji-', 'destinationId',
  'Actual marker editor initializes current symbol and color.', component('DestinationReorderList'));
button('map.route.emoji.save', ['MAP-ROUTE-09', 'MAP-ROUTE-12'], 'emoji confirm → onUpdateEmojiColor', 'dest-emoji-confirm',
  'Real marker save preserves optimistic mutation ownership and shows actual failure.', component('DestinationReorderList'));
button('map.route.trip.open', ['MAP-ROUTE-10', 'MAP-ROUTE-12'], 'trip settings onPress', 'route-trip-details',
  'Actual trip form copies days/date and preserves existing past departure save rules.', component('DestinationReorderList'));
button('map.route.trip.more-days', ['MAP-ROUTE-10'], 'setEditDays', 'route-days-increase',
  'Actual controlled day count increases before commit.', component('DestinationReorderList'));
button('map.route.trip.fewer-days', ['MAP-ROUTE-10'], 'setEditDays', 'route-days-decrease',
  'Actual controlled day count clamps to one.', component('DestinationReorderList'));
operation('map.route.day-color', ['MAP-ROUTE-12'], component('DestinationReorderList'), 'setDayColor',
  '{ color: string }', 'Real day color selection persists through existing account/group storage key.',
  (app, { color }) => press(app, `route-day-color-${color}`));
for (const [name, prefix, symbol, ids, completion] of [
  ['set', 'route-set-stay-', 'onToggleSetStay', ['MAP-ROUTE-12'], 'Actual day header enters stay selection.'],
  ['cancel', 'route-cancel-stay-', 'onCancelSetStay', ['MAP-ROUTE-12'], 'Actual stay selection cancels without draft mutation.'],
  ['remove', 'route-remove-stay-', 'onRemoveDaily → onClearDailyAccommodation', ['MAP-STAY-01'], 'Real Map callback removes only the daily setting and marks daily draft dirty.'],
  ['quick-add', 'route-quick-stay-', 'onQuickAddAccommodation', ['MAP-STAY-03'], 'Real Map callback derives a unique draft accommodation from day stay or last stop.'],
]) {
  operation(`map.route.stay.${name}`, ids, component('DestinationReorderList'), symbol, '{ day: number }', completion,
    (app, { day }) => press(app, `${prefix}${day}`));
  operations[`map.route.stay.${name}`].sources = source(component('DestinationReorderList'), prefix);
}
identifiedButton('map.route.stay.select', ['MAP-STAY-02', 'MAP-ROUTE-12'], 'onSelectAsStay → onSetDailyFromDestination', 'route-select-stay-', 'destinationId',
  'Actual Map callback snapshots selected stop into date stay, removes source stop and queues deletion once.', component('DestinationReorderList'));
button('map.kml.open', ['MAP-DEST-08', 'MAP-DEST-09'], 'onImport → openKmlImportForScope', 'route-kml',
  'Real Map caller flushes dirty route before quota read and import visibility.', component('DestinationReorderList'));
button('map.kml.pick', ['K01', 'K02', 'K03', 'K04'], 'pickFile', 'kml-pick-file',
  'Real picker callback loads/parses actual KML/KMZ through external filesystem and projects capped preview.', component('KmlImportSheet'));
button('map.kml.import', ['MAP-DEST-07', 'K05', 'K06'], 'runImport → MapScreen.handleKmlImport', 'kml-import-confirm',
  'Real preview slice reaches atomic writer import or follower request; actual error stage and progress remain visible.', component('KmlImportSheet'));
button('map.kml.retry', ['K07'], 'reset', 'kml-retry', 'Actual failed import resets to intro without a write.', component('KmlImportSheet'));

identifiedButton('map.journey.command', ['MAP-NAV-01', 'MAP-NAV-02', 'MAP-NAV-03', 'MAP-NAV-04', 'MAP-GATHER-04', 'MAP-GATHER-05', 'MAP-GATHER-07'],
  'gather-nav onPress dispatch', 'gather-nav-', 'destinationId',
  'Actual card command chooses Start, End, request-start or complete from real role, session and arrival state.');
identifiedButton('map.arrival.mark', ['MAP-ARRIVAL-01', 'MAP-ARRIVAL-05', 'MAP-ARRIVAL-06'], 'handleSelfArrival', 'gather-arrival-', 'destinationId',
  'Actual card writes device-now personal arrival after the pending-Start barrier; arrival alone never completes a stop.');
identifiedButton('map.arrival.undo', ['MAP-ARRIVAL-03', 'MAP-ARRIVAL-04'], 'handleArrival', 'gather-arrival-undo-', 'destinationId',
  'Actual self undo confirmation persists the matching session marker and suppresses automatic inside-radius reentry.');
button('map.arrival.manage', ['MAP-ARRIVAL-04'], 'arrivalManage open onPress', 'map-arrival-manage',
  'Actual main-leader history correction controls appear only for closed main history.');
operation('map.arrival.correct', ['MAP-ARRIVAL-04'], screen, 'handleArrival', '{ destinationId: string, userId: string }',
  'Actual historical correction preserves closedBySessionId, actor and null timestamp correction semantics.',
  (app, { destinationId, userId }) => press(app, `history-arrival-${destinationId}-${userId}`));
operation('map.location.native-sample', ['MAP-LOC-01', 'MAP-LOC-02', 'MAP-ARRIVAL-02', 'MAP-PROGRESS-01', 'MAP-PROGRESS-02'], component('GroupMap'), 'onUserLocationSample',
  '{ latitude: number, longitude: number, accuracy?: number, timestamp?: number }',
  'Actual iOS MapKit callback enters source ownership, freshness, privacy, arrival and progress guards.',
  (app, input) => app.host.call({ kind: 'nativeEvent', testId: 'group-map-native', value: {
    event: 'onUserLocationChange', nativeEvent: { coordinate: input },
  } }));
button('map.location.refresh', ['MAP-LOC-03'], 'refreshAllLocations', 'map-refresh-locations',
  'Actual screen refresh coordinates self upload, peer request, cooldown and acknowledged result.');
button('map.location.locate', ['MAP-LOC-03'], 'locateMe', 'map-locate-me',
  'Actual screen centers cached GPS then refreshes device location with actual permission and fresh-sample rules.');
operations['map.location.locate'].sources = [...source(screen, 'locateMe'), ...source(component('MapRecenterControl'), 'map-locate-me')];
button('map.location.fit', ['MAP-LOC-04', 'MAP-NAV-06'], 'fitAllMembers', 'map-fit-all',
  'Actual screen fits own and visible peer coordinates through the native camera boundary.');
operations['map.location.fit'].sources = [...source(screen, 'fitAllMembers'), ...source(component('MapRecenterControl'), 'map-fit-all')];
button('map.sharing.toggle', ['MAP-LOC-05', 'MAP-LOC-06', 'MAP-LOC-07'], 'handleSharingEnabledChangeAnimated', 'members-location-sharing',
  'Actual confirmation/permission flow persists local consent before transport; cancellation cannot mutate privacy.');
identifiedButton('map.external-navigation', ['MAP-NAV-07'], 'openExternalNavigation', 'gather-external-', 'destinationId',
  'Actual provider choice constructs travel-mode URL and uses native Linking boundary.');
identifiedButton('map.travel-mode', ['MAP-TOOLS-01', 'MAP-ROUTES-01', 'MAP-PROGRESS-01'], 'travel-mode onPress', 'gather-travel-mode-', 'destinationId',
  'Actual walk/bicycle/transit/drive cycle persists preference and invalidates real route/ETA generation.');
button('map.passive.enter', ['MAP-TOOLS-01'], 'setPassiveCompanionMode(true)', 'tools-enter-passive',
  'Actual preference switches display and map ownership without changing sharing consent or team journey.');
button('map.passive.exit', ['MAP-TOOLS-01'], 'exitPassiveCompanionMode', 'passive-switch-back',
  'Actual AmicroButton restores dense map presentation.', panel('PassiveCompanionPanel'));
operation('map.live-activity.toggle', ['MAP-TOOLS-01'], screen, 'handleToolsLiveActivityChange', '{ enabled: boolean }',
  'Actual entitlement gate persists allowed preference or opens subscription and keeps the toggle false.',
  (app, { enabled }) => app.host.call({ kind: 'toggle', testId: 'tools-live-activity-toggle', value: enabled }));

button('map.ops.open', ['MAP-COORD-01', 'MAP-COORD-08', 'MAP-OPS-01'], 'ops open onPress', 'map-open-ops',
  'Actual operations panel displays real coordination and organizer exception hooks.');
button('map.coordination.create.open', ['MAP-COORD-02'], 'openCreate', 'coordination-open-create',
  'Actual create form begins without stale selection.', panel('CoordinationRequestsPanel'));
button('map.coordination.create.cancel', ['MAP-COORD-02'], 'closeCreate', 'coordination-create-back',
  'Actual cancel resets subject/options/policy without creating a request.', panel('CoordinationRequestsPanel'));
for (const [field, id] of [['subject', 'coordination-subject-input'], ['option-a', 'coordination-option-a'], ['option-b', 'coordination-option-b']]) {
  operation(`map.coordination.${field}`, ['MAP-COORD-02'], panel('CoordinationRequestsPanel'), id,
    '{ value: string }', 'Actual controlled request draft changes without a write.', (app, { value }) => text(app, id, value));
}
operation('map.coordination.policy', ['MAP-COORD-02'], panel('CoordinationRequestsPanel'), 'setPolicy', '{ policy: string }',
  'Actual policy selection is serialized by the real create controller.',
  (app, { policy }) => press(app, `coordination-policy-${policy}`));
button('map.coordination.create.submit', ['MAP-COORD-02'], 'handleCreate', 'coordination-create-submit',
  'Actual create validates trimmed subject, sends two real options and deadline, prevents duplicates and retains failed draft.', panel('CoordinationRequestsPanel'));
identifiedButton('map.coordination.select', ['MAP-COORD-08'], 'request row onPress', 'coordination-row-', 'requestId',
  'Detail follows the selected actual request ID through reload.', panel('CoordinationRequestsPanel'));
identifiedButton('map.coordination.respond', ['MAP-COORD-03'], 'handleRespond', 'coordination-option-', 'optionId',
  'Actual open-request response guard prevents overlapping writes and projects current user selection.', panel('CoordinationRequestsPanel'));
identifiedButton('map.coordination.override', ['MAP-COORD-04'], 'handleOverride', 'coordination-override-', 'optionId',
  'Actual main leader control resolves a request and freezes closed options.', panel('CoordinationRequestsPanel'));
button('map.coordination.cancel', ['MAP-COORD-05'], 'handleCancel', 'coordination-cancel',
  'Actual successful cancel clears selection while failure retains the request.', panel('CoordinationRequestsPanel'));
button('map.coordination.back', ['MAP-COORD-08'], 'detail back onPress', 'coordination-detail-back',
  'Actual detail selection clears and returns to current list.', panel('CoordinationRequestsPanel'));
for (const action of ['acknowledge', 'resolve', 'reopen']) {
  operation(`map.exception.${action}`, ['MAP-OPS-01'], screen, `markExceptionHandled(${action})`, '{ rootCauseKey: string }',
    'Actual scoped exception action uses root-cause busy guard and real service projection.',
    (app, { rootCauseKey }) => press(app, `map-exception-${action}-${rootCauseKey}`));
  operations[`map.exception.${action}`].sources = source(screen, 'markExceptionHandled');
}
for (const action of ['approve', 'reject']) {
  identifiedButton(`map.suggestion.${action}`, ['MAP-GATHER-01', 'MAP-GATHER-02'], 'handleGatherPointRequest', `gather-request-${action}-`, 'requestId',
    'Actual FIFO inbox optimistically removes the card, persists decision and restores exact selection/order on error.');
}
button('map.history.open', ['MAP-HISTORY-01'], 'loadHistory', 'map-history',
  'Real history load combines actual visited rows, session arrivals, closed stops and pending durable rows.');
identifiedButton('map.history.delete', ['MAP-HISTORY-02'], 'handleDeleteHistory', 'history-delete-', 'historyId',
  'Actual confirmation chooses cancel or owner-scoped delete then real history reload.');
for (const verb of ['accept', 'decline']) {
  identifiedButton(`map.subgroup.invite.${verb}`, ['MAP-MEMBER-02'], `handle${verb === 'accept' ? 'Accept' : 'Decline'}Invite`, `subgroup-invite-${verb}-`, 'inviteId',
    'Actual pending invitation guard invokes real subgroup service and refreshes correct scope.');
}
button('map.subgroup.split', ['MAP-MEMBER-02'], 'doSelfSplit', 'map-subgroup-split',
  'Actual warning/confirmation precedes real subgroup creation and scope reset.');
button('map.subgroup.merge', ['MAP-MEMBER-02'], 'doSelfMerge', 'map-subgroup-merge',
  'Actual merge action calls production subgroup service, refreshes and resets scope.');
identifiedButton('map.member.kick', ['MAP-MEMBER-03'], 'handleKickMember', 'map-kick-', 'userId',
  'Actual leader/nonself confirmation reaches real kick and refresh; cancellation has no write.');
button('map.group.copy-code', ['MAP-GROUP-01'], 'copyCode', 'map-copy-code',
  'Actual code copy respects anonymous cap and records clipboard command and copied timeout.');
button('map.group.invite', ['MAP-GROUP-01'], 'invite open onPress', 'map-invite-members',
  'Actual member pane opens invitation controls without changing membership.');
button('map.group.share-code', ['MAP-GROUP-01'], 'shareCode', 'map-share-code',
  'Actual AmicroButton share sends configured invite URL/code through platform Share adapter.');
button('map.settings.open', ['MAP-SHELL-01'], 'openSettingsFromSheet', 'map-settings',
  'Real settings opening preserves Map callback wiring for account, reset, leave, archive and sign-out.');
button('map.profile.open', ['MAP-PROFILE-01'], 'openProfile', 'map-profile',
  'Actual Map avatar opens the real ProfileOverlay with production updateProfile and group refresh callbacks.');
button('map.group.home', ['MAP-GROUP-02'], 'onGoHome → goHomeCreateOrJoin', 'settings-go-home',
  'Actual Map settings callback closes settings and resets home navigation while retaining membership.', panel('SettingsOverlay'));
button('map.group.leave', ['MAP-GROUP-02'], 'onConfirmLeave → confirmLeave', 'settings-leave',
  'Actual Map settings callback confirms leave, clears appropriate Live Activity and preserves membership on failure.', panel('SettingsOverlay'));
button('map.group.signout', ['MAP-GROUP-02'], 'onConfirmSignOut → confirmSignOut', 'settings-signout',
  'Actual Map settings callback confirms sign-out, handles timeout and resets navigation after successful session change.', panel('SettingsOverlay'));
button('map.group.archive', ['MAP-HISTORY-03'], 'onArchiveAllForTest → archiveAllForTest', 'settings-archive',
  'Development-only real Map callback records history best effort before sequential deletes and navigation stop.', panel('SettingsOverlay'));
button('map.settings.reset', ['MAP-SETTINGS-02'], 'onConfirmResetPrefs → confirmResetPrefs', 'settings-reset-preferences',
  'Actual Map confirmation resets onboarding, tours and preferences through durable replay.', panel('SettingsOverlay'));
button('map.settings.group-avatar.save', ['MAP-SETTINGS-01'], 'handleSaveGroupAvatar → onUpdateGroupAvatar', 'settings-group-avatar-save',
  'Actual Map callback updates group avatar then refreshes group projection.', panel('SettingsOverlay'));
operation('map.route.scope', ['MAP-ROUTE-11'], screen, 'toggleRouteScope', '{ scope: main | subgroup }',
  'Actual view-only route scope toggle persists account/group expansion.',
  (app, { scope }) => press(app, `route-scope-toggle-${scope}`));
button('map.store.register', ['MAP-STORE-01'], 'onRequireRegistration', 'store-register',
  'Actual Map Store caller opens account registration.', panel('StorePane'));
button('map.store.subscribe', ['MAP-STORE-01'], 'onOpenSubscribe', 'store-open-subscribe',
  'Actual Map Store caller opens paywall without Restore.', panel('StorePane'));
operation('map.overlay.done', ['MAP-ROUTE-01', 'MAP-ROUTE-05', 'MAP-ROUTE-06', 'MAP-ROUTE-07'], component('OverlaySheet'), 'handleDone',
  '{ label: string }', 'Actual visible overlay Done/close dispatches its current callback; route close executes real single-flight draft flush.',
  (app, { label }) => app.host.call({ kind: 'press', label }));
identifiedButton('map.meet.open', ['MAP-MEET-01'], 'openMeetTimePicker', 'gather-meet-time-', 'destinationId',
  'Actual card initializes date/day/clamped time and current shared warning threshold.');
operation('map.meet.threshold', ['MAP-MEET-01'], screen, 'setMeetTimeEditor', '{ minutes: number }',
  'Actual segmented control changes editor threshold; it remains a draft until successful save.',
  (app, { minutes }) => press(app, `segmented-tab-${minutes}`));
operation('map.meet.shortcut', ['MAP-MEET-01'], screen, 'addMinutesToPickerValue', '{ minutes: 10 | 30 | 60 }',
  'Actual shortcut advances current picker date and marks selected shortcut without persistence.',
  (app, { minutes }) => press(app, `meet-time-plus-${minutes}`));
button('map.meet.save', ['MAP-MEET-01', 'MAP-MEET-02'], 'persistMeetTime', 'meet-time-save',
  'Actual Map three-argument service caller uses remote itinerary update; preference updates only after success.');
button('map.meet.clear', ['MAP-MEET-01', 'MAP-MEET-02'], 'persistMeetTime(null)', 'meet-time-clear',
  'Actual Map caller clears remote meet time without creating a durable group operation.');
operation('map.carousel.begin', ['MAP-SHELL-02'], screen, 'handleScrollBeginDrag', '{}',
  'Actual scroll callback records user intent and clears older programmatic selection ownership.',
  app => app.host.call({ testId: 'map-carousel', kind: 'nativeEvent', value: { event: 'onScrollBeginDrag', nativeEvent: {} } }));
operation('map.carousel.end', ['MAP-SHELL-02', 'MAP-NAV-06'], screen, 'handleMomentumEnd', '{ x: number }',
  'Actual momentum callback clamps index, rejects stale programmatic completions and frames a real user-selected destination.',
  (app, { x }) => app.host.call({ testId: 'map-carousel', kind: 'nativeEvent', value: { event: 'onMomentumScrollEnd', nativeEvent: { contentOffset: { x, y: 0 } } } }));
operation('map.presence.select', ['MAP-MEMBER-01'], screen, 'applyPresenceMacroKind', '{ value: follow | solo | stealth }',
  'Actual iOS attached menu changes presence through notification/sharing/solo writes; Android opens its real Alert choices.',
  (app, { value }) => app.platform === 'ios'
    ? app.host.call({ testId: 'map-presence', kind: 'nativeEvent', value: { event: 'onSelect', nativeEvent: { id: value } } })
    : press(app, 'map-presence'));

const services = {
  'destination.add': ['DestinationService', 'addDestination', ['MAP-DEST-04']],
  'destination.import': ['DestinationService', 'addDestinationsBatch', ['MAP-DEST-07']],
  'destination.quota': ['DestinationService', 'getKmlImportQuota', ['MAP-DEST-09']],
  'destination.delete': ['DestinationService', 'deleteDestination', ['MAP-ROUTE-08']],
  'destination.complete': ['DestinationService', 'completeGatheringStop', ['MAP-GATHER-04']],
  'destination.reorder': ['DestinationService', 'reorderDestinations', ['MAP-ROUTE-04']],
  'destination.marker': ['DestinationService', 'updateDestinationEmojiColor', ['MAP-ROUTE-09']],
  'destination.meet-time': ['DestinationService', 'setDestinationMeetTime', ['MAP-MEET-02']],
  'stay.list': ['DailyAccommodationService', 'listDailyAccommodations', ['MAP-STAY-06']],
  'stay.date': ['DailyAccommodationService', 'getDailyAccommodationForDate', ['MAP-STAY-06']],
  'stay.set': ['DailyAccommodationService', 'setDailyAccommodation', ['MAP-STAY-04']],
  'stay.clear': ['DailyAccommodationService', 'clearDailyAccommodation', ['MAP-STAY-05']],
  'stay.auto-add': ['DailyAccommodationService', 'setAccommodationAutoAdd', ['MAP-STAY-06']],
  'favorite.list': ['FavoritePlacesService', 'listFavoritePlaces', ['F01']],
  'favorite.save': ['FavoritePlacesService', 'saveFavoritePlace', ['F02']],
  'favorite.delete': ['FavoritePlacesService', 'unsaveFavoritePlace', ['F03']],
  'favorite.exact-delete': ['FavoritePlacesService', 'unsaveFavoriteByExactMatch', ['F04']],
  'coordination.resolve-due': ['CoordinationRequestService', 'resolveDueCoordinationRequests', ['MAP-COORD-06']],
  'coordination.resolve-deadline': ['CoordinationRequestService', 'resolveCoordinationRequestDeadline', ['MAP-COORD-06']],
  'coordination.requests': ['CoordinationRequestService', 'fetchCoordinationRequests', ['MAP-COORD-07']],
  'coordination.responses': ['CoordinationRequestService', 'fetchCoordinationResponses', ['MAP-COORD-07']],
  'coordination.operations': ['CoordinationRequestService', 'fetchItineraryOperations', ['MAP-COORD-07']],
  'coordination.create': ['CoordinationRequestService', 'createCoordinationRequest', ['MAP-COORD-02']],
  'coordination.respond': ['CoordinationRequestService', 'respondToCoordinationRequest', ['MAP-COORD-03']],
  'coordination.override': ['CoordinationRequestService', 'overrideCoordinationRequest', ['MAP-COORD-04']],
  'coordination.cancel': ['CoordinationRequestService', 'cancelCoordinationRequest', ['MAP-COORD-05']],
  'gathering.suggest': ['GatheringWorkflowService', 'submitGatherPointRequest', ['MAP-DEST-05']],
  'gathering.pending': ['GatheringWorkflowService', 'fetchPendingGatherPointRequests', ['MAP-GATHER-01']],
  'gathering.resolve': ['GatheringWorkflowService', 'resolveGatherPointRequest', ['MAP-GATHER-02']],
  'gathering.resolve-resilient': ['GatheringWorkflowService', 'resolveGatherPointRequestResilient', ['MAP-GATHER-02']],
  'gathering.arrivals': ['GatheringWorkflowService', 'fetchDestinationArrivals', ['MAP-GATHER-01']],
  'gathering.arrival': ['GatheringWorkflowService', 'setDestinationArrival', ['MAP-ARRIVAL-01']],
  'gathering.arrival-at': ['GatheringWorkflowService', 'setDestinationArrivalAt', ['MAP-ARRIVAL-01']],
  'gathering.correct-arrival': ['GatheringWorkflowService', 'correctDestinationArrival', ['MAP-ARRIVAL-04']],
  'history.record': ['WaypointService', 'recordVisitedWaypoint', ['MAP-HISTORY-03']],
  'history.list': ['WaypointService', 'fetchVisitedWaypoints', ['MAP-HISTORY-01']],
  'history.delete': ['WaypointService', 'deleteVisitedWaypoint', ['MAP-HISTORY-02']],
  'navigation.start': ['NavigationService', 'startNavigationSession', ['MAP-NAV-01']],
  'navigation.cancel': ['NavigationService', 'cancelNavigationSession', ['MAP-NAV-03']],
  'navigation.complete': ['NavigationService', 'completeNavigationSession', ['MAP-GATHER-04']],
  'navigation.ack': ['NavigationService', 'ackNavigationSession', ['MAP-LOC-06']],
  'navigation.set-sharing': ['NavigationService', 'setLocationSharingEnabled', ['MAP-LOC-05']],
  'navigation.get-sharing': ['NavigationService', 'getLocationSharingEnabled', ['MAP-LOC-06']],
  'navigation.active': ['NavigationService', 'getActiveNavigationSession', ['MAP-GATHER-03']],
  'navigation.by-id': ['NavigationService', 'getNavigationSessionById', ['MAP-GATHER-03']],
  'navigation.background-context': ['NavigationService', 'getBackgroundNavigationContext', ['MAP-LOC-07']],
  'navigation.my-state': ['NavigationService', 'getMyNavigationMemberState', ['MAP-GATHER-03']],
  'navigation.member-states': ['NavigationService', 'listNavigationMemberStates', ['MAP-GATHER-03']],
};
for (const [name, [module, symbol, inventory]] of Object.entries(services)) {
  operation(`map.service.${name}`, inventory, `src/api/services/${module}.ts`, symbol, '{ args: Parameters<typeof entry> }',
    'Real callable service completes against durable SQLite or explicit external SDK contract; this entry alone does not prove its UI caller.',
    (_app, { args }) => {
      assert(Array.isArray(args), 'Service arguments must be an array');
      const service = require(`../../src/api/services/${module}`);
      assert.equal(typeof service[symbol], 'function', `Missing production export ${symbol}`);
      return service[symbol](...args);
    }, 'service');
}

exports.operations = operations;
exports.catalog = () => Object.entries(operations).map(([name, { run, ...metadata }]) => ({ name, ...metadata }));
exports.lifecycle = [
  { name: 'map.journey.reconcile', inventory: ['MAP-NAV-05'],
    sources: source('src/screens/MapScreen/hooks/useJourneyNavigation.ts', 'useJourneyNavigation'),
    trigger: 'Mount actual MapScreen, deliver held Start/End ACK, durable snapshots and session events, then restart actor.',
    scenarios: ['headlessScenario.test.ts::keeps End authoritative', 'headlessScenario.test.ts::restores offline Start'] },
  { name: 'map.arrival.exit', inventory: ['MAP-GATHER-06'], sources: source(screen, 'startArrivalCardExit'),
    trigger: 'Actual completion updates closed destinations. Advance logical celebrate/hold/remove timers and change screen context.',
    scenarios: ['headlessMapScenario.test.ts'] },
  { name: 'map.card.idle-collapse', inventory: ['MAP-SHELL-03'],
    sources: source('src/screens/MapScreen/hooks/useGatherCardExpansion.ts', 'useGatherCardExpansion'),
    trigger: 'Mount real Map, expand card, register activity, pause for real tour and advance ten-second timer.',
    scenarios: ['headlessMapScenario.test.ts'] },
  { name: 'map.pending-place.presentation', inventory: ['MAP-SHELL-04'],
    sources: source('src/screens/MapScreen/hooks/usePendingPlaceEntrance.ts', 'usePendingPlaceEntrance'),
    trigger: 'Actual long-press/search stages a pending place; cancel/add updates retained place and unmount cleanup.',
    scenarios: ['headlessMapScenario.test.ts::cancel writes nothing'] },
  { name: 'map.tour.persistence', inventory: ['MAP-TOUR-01'], sources: source(screen, 'onRouteTourNext'),
    trigger: 'Use real tour Next/Previous/completion after native measured rect callback; reset through actual Map settings confirmation.',
    scenarios: ['headlessMapScenario.test.ts'] },
  { name: 'map.store.entitlement-refresh', inventory: ['MAP-STORE-01'], sources: source(screen, 'refreshStoreEntitlements'),
    trigger: 'Actual StorePane redemption or subscription calls Map onEntitlementChanged/onEntitlementActivated and refreshes real projection.',
    scenarios: ['headlessMapScenario.test.ts'] },
];
exports.unreachable = [{ name: 'map.coordinates.parent-submit', inventory: ['MAP-DEST-06'],
  sources: [...source(screen, 'openCoordinateSheet'), ...source(screen, 'handleCoordinateDestination')],
  reason: 'openCoordinateSheet has no production caller. CoordinateDestinationSheet is mounted permanently with coordSheetVisible initially false; no actual control sets it true. Standalone Q05 covers the real form but does not execute this Map parent closure.' }];
