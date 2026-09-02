import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');
const client = readFileSync(join(__dirname, '../api/client.ts'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const groupState = readFileSync(join(__dirname, '../state/useGroupState.ts'), 'utf8');
const groupNotifications = readFileSync(
  join(__dirname, '../state/useGroupNotifications.ts'),
  'utf8',
);
const i18n = [
  readFileSync(join(__dirname, '../i18n/locales/zh.ts'), 'utf8'),
  readFileSync(join(__dirname, '../i18n/locales/en.ts'), 'utf8'),
].join('\n');
const reorderList = readFileSync(
  join(__dirname, '../components/DestinationReorderList.tsx'),
  'utf8',
);
const pushIndex = readFileSync(
  join(root, 'supabase/functions/send-push/index.ts'),
  'utf8',
);
const pushMessages = readFileSync(
  join(root, 'supabase/functions/send-push/messages.ts'),
  'utf8',
);
const pushRecipients = readFileSync(
  join(root, 'supabase/functions/send-push/recipients.ts'),
  'utf8',
);

describe('gathering approval, arrivals, history, and push contracts', () => {
  it('persists leader-approved gathering-point requests', () => {
    expect(migrations).toContain('create table public.gather_point_requests');
    expect(migrations).toContain('public.submit_gather_point_request');
    expect(migrations).toContain('public.resolve_gather_point_request');
    expect(migrations).toContain("status in ('pending', 'approved', 'rejected')");
    expect(migrations).toContain('subgroup does not belong to group');
    expect(migrations).toContain("returns jsonb");
    expect(migrations).toContain("'inserted_count'");
    expect(migrations).toMatch(
      /create or replace function extensions\.notify_push[\s\S]*exception[\s\S]*when others then/i,
    );
    expect(client).toContain('submitGatherPointRequest');
    expect(client).toContain('resolveGatherPointRequest');
    expect(client).toContain('resolveGatherPointRequestResilient');
  });

  it('keeps gather-approve UI resilient to network blips', () => {
    expect(mapScreen).toContain('resolveGatherPointRequestResilient');
    expect(mapScreen).toContain('isNetworkRequestError');
    expect(mapScreen).toContain('gather_request_resolve');
    expect(mapScreen).toContain('resolvingGatherRequestId');
    expect(mapScreen).toContain("t('gatherRequest.networkFailed')");
  });

  it('stores per-member destination arrivals and supports manual marking', () => {
    expect(migrations).toContain('create table public.destination_arrivals');
    expect(migrations).toContain('unique (destination_id, user_id)');
    expect(migrations).toContain('public.set_destination_arrival');
    expect(migrations).toContain('public.set_destination_arrival_at');
    expect(migrations).toContain('p_arrived_at timestamptz');
    expect(migrations).toContain('set arrived_at = p_arrived_at');
    expect(migrations).toContain("v_journey_status = 'paused' and not p_arrived");
    expect(migrations).toContain("v_journey_status = 'paused'");
    expect(migrations).toContain('paused destination requires an existing arrival');
    expect(migrations).toContain('m.subgroup_id is not distinct from i.subgroup_id');
    // Sequential mark: earlier open stops for this user, not active_destination max.
    // Past trip days are excluded so today's first visible card is markable.
    expect(migrations).toContain('i.position < v_destination.position');
    expect(migrations).toContain('i.closed_at is null');
    expect(migrations).toContain('v_current_day');
    expect(migrations).toContain('coalesce(i.day, 1) >= v_current_day');
    expect(migrations).toMatch(
      /on_member_location_arrival[\s\S]*insert into public\.destination_arrivals/,
    );
    expect(client).toContain('setDestinationArrival');
    expect(client).toContain('setDestinationArrivalAt');
    expect(mapScreen).toContain('destinationArrivals');
    expect(mapScreen).toContain("t('arrival.mark')");
    expect(mapScreen).toContain("t('common.confirm')");
    expect(mapScreen).toContain('arrivalErrorMessage');
    expect(mapScreen).toContain('future destination cannot be completed');
    expect(mapScreen).toContain('arrivalMemberRow');
    expect(mapScreen).toContain('checkmark-circle');
    expect(i18n).toContain("'arrival.errFuture'");
    expect(i18n).toContain("'arrival.failedTitle'");
  });

  it('keeps itinerary editing and flag colours leader-only', () => {
    expect(mapScreen).toContain('const canEditItinerary = Boolean(isLeader || isMySubgroupLeader)');
    expect(reorderList).toContain('canEditColors={canReorder}');
    expect(migrations).toContain('drop policy if exists "itinerary_items: insert if in that subgroup"');
  });

  it('filters the request inbox to the leader\'s active route scope', () => {
    expect(mapScreen).toContain('requests.filter((request) => request.subgroupId === myScopeIdRef.current)');
    expect(mapScreen).toContain('requests.filter((request) => request.subgroupId == null)');
  });

  it('gates quick-add stay CTA; day headers use left-swipe collapse↔drag mutex', () => {
    // 「新增住宿點」only after stay is set (hasDaily).
    expect(reorderList).toMatch(/showQuickAdd[\s\S]{0,200}hasDaily/);
    // Default collapse; left-swipe toggles drag handle (not both at once).
    expect(reorderList).toContain('headerAffordanceByDay');
    expect(reorderList).toContain('canSwipeToggleAffordance');
    expect(reorderList).toContain('onSwipeToggleAffordance');
    expect(reorderList).toContain("headerAffordance === 'collapse'");
    expect(reorderList).toContain("headerAffordance === 'drag'");
    // Day2+ moves only the day separator; destination flat order is stable.
    expect(reorderList).toContain('moveDayHeaderBefore');
    expect(reorderList).toContain('REVEAL_WIDTH');
  });

  it('locks stay cards to bed emoji and allows them as set-stay radio sources', () => {
    expect(reorderList).toContain('STAY_MARKER_EMOJI');
    expect(reorderList).toContain('STAY_BADGE_BG');
    // Accommodation rows share the normal stop surface; only an exact
    // daily-stay duplicate warns.
    expect(reorderList).toContain('isAccommodation={isStayCard}');
    expect(reorderList).not.toContain('rowAccommodation');
    expect(reorderList).toContain('shouldHighlightStayDuplicate');
    expect(reorderList).toContain('rowStayDuplicate');
    // No emoji picker for accommodation kind.
    expect(reorderList).toMatch(
      /onEmojiPress=\{\s*[\s\S]*?!isStayCard/,
    );
    // Set-stay checkboxes include accommodation (cross-day moved stay cards).
    expect(reorderList).toContain('showSelect={inSetMode}');
    expect(reorderList).not.toContain(
      'showSelect={inSetMode && item.item.kind !== \'accommodation\'}',
    );
    // Commit path must not refuse accommodation picks.
    expect(reorderList).not.toMatch(
      /if \(pick && pick\.item\.kind !== 'accommodation'\)/,
    );
    expect(reorderList).not.toContain('accentMix(colors.accent, 18)');
    expect(reorderList).toContain('accentOver(colors.accent, shade(colors.surface, -0.20), 28)');
    expect(reorderList).not.toContain('backgroundColor: colors.danger');
    expect(reorderList).toContain('backgroundColor: glass.fill');
  });

  it('reconciles group state periodically even when Realtime misses an event', () => {
    expect(groupState).toContain('realtimeReadyRef');
    expect(groupState).toContain("status === 'SUBSCRIBED'");
    expect(groupState).toContain("status === 'TIMED_OUT'");
    expect(groupState).toContain("status === 'CHANNEL_ERROR'");
    expect(groupState).toContain("status === 'CLOSED'");
    expect(groupState).toContain('const timer = setInterval');
    expect(groupState).toMatch(/void loadRef\.current\(/);
    expect(groupState).not.toContain('const profilesChannel');
  });

  it('coalesces workflow events and guards destination deletion to leaders', () => {
    expect(mapScreen).toContain('scheduleWorkflowReload');
    expect(mapScreen).toContain('if (!canEditItinerary) return;');
  });

  it('offers database reconciliation and refreshes before arrival writes', () => {
    expect(reorderList).toContain('onSync?: () => Promise<void>');
    expect(reorderList).toContain("t('kml.entry')");
    expect(reorderList).toContain('onImport?:');
    expect(reorderList).toContain("t('map.syncDbRetry')");
    expect(mapScreen).toContain('const syncFromDatabase = useCallback');
    expect(mapScreen).toContain('setOptimisticDestinations(null)');
    expect(mapScreen).toContain('syncFromDatabase()');
    // Open-once silent sync + import CTA; retry only after failed open-sync (#154).
    expect(mapScreen).toContain('routeOpenSyncSessionRef');
    expect(mapScreen).toContain('openKmlImportForScope');
    expect(mapScreen).toContain(
      'onSync={routeSyncFailed ? retryRouteSync : undefined}',
    );
    expect(mapScreen).toContain(
      'if (await syncFromDatabaseAndUploadLogs()) setRouteSyncFailed(false)',
    );
    expect(mapScreen).toContain('uploadLocalLogs');
    expect(mapScreen).toContain('const syncFromDatabaseAndUploadLogs');
    expect(i18n).toContain("'map.syncDb'");
    expect(i18n).toContain("'map.syncDbRetry'");
  });

  it('gates foreground arrival ACK to session/status transitions', () => {
    expect(mapScreen).toContain('foregroundAckRef');
    expect(mapScreen).toContain("source: 'foreground_arrival_reducer'");
    expect(mapScreen).toContain('foregroundAckRef.current !== ackKey');
  });

  it('allows authorized history deletion without deleting arrival completion', () => {
    expect(migrations).toContain('arrival_id uuid');
    expect(migrations).toContain('destination_id uuid');
    expect(migrations).toContain('visited_waypoints: delete own or leader');
    expect(client).toContain('deleteVisitedWaypoint');
    expect(mapScreen).toContain('handleDeleteHistory');
  });

  it('projects history as own-or-leader and completes stops for the whole team', () => {
    expect(migrations).toContain('visited_waypoints: select own or leader');
    expect(migrations).toContain('complete_gathering_stop');
    expect(migrations).toContain('insert into public.visited_waypoints');
    expect(client).toContain('completeGatheringStop');
    expect(mapScreen).toContain('projectHistoryForViewer');
    expect(mapScreen).toContain('completeGatheringStop');
    expect(mapScreen).toContain('leader_mark_complete');
    expect(migrations).toContain('coalesce(i.day, 1) >= v_current_day');
    expect(pushMessages).toContain('gathering_completed');
    expect(pushMessages).toMatch(/nameOr\(p\.sender_name/);
    expect(pushMessages).toMatch(/placeOr\(p\.title\)/);
  });

  it('fans quick commands to the whole group with sender nickname titles', () => {
    expect(pushIndex).toContain('wholeGroupCommand');
    // Exclude the sender; the server enriches nickname once and uses message as body.
    expect(pushIndex).toContain('member.user_id !== payload.sender_id');
    expect(pushMessages).toMatch(/title: nameOr\(p\.sender_name/);
    expect(pushMessages).toContain('body: p.message?.trim() || label');
    expect(pushMessages).toContain('gathering_request');
  });

  it('routes request_start through follower preferences to leaders only', () => {
    expect(migrations).toContain("'custom','request_start'");
    expect(migrations).toContain("'found_something','request_start'");
    // send-push uses specialAlertRecipientIds (arrival + request_start leader fan-out).
    expect(pushIndex).toContain('specialAlertRecipientIds(payload, members)');
    expect(pushRecipients).toContain('requestStartRecipientIds');
    expect(pushRecipients).toContain('.filter((member) => member.role === "leader")');
    expect(pushMessages).toContain('request_start: "要求開始"');
    expect(mapScreen).toContain("'request_start'");
    expect(groupNotifications).toContain(
      "row.type === 'request_start' && !isLeaderRef.current",
    );
  });
});
