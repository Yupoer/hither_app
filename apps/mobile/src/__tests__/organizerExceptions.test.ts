import {
  availableActionsFor,
  buildOrganizerExceptions,
  buildRootCauseKey,
  buildSessionKey,
  collectExceptionCandidates,
  dedupeExceptionCandidates,
  exceptionTypeFromNavStatus,
  lateSignalsFromMeetTime,
  mergePriorObservations,
  parseTimeMs,
  resolveEffectiveHandling,
  sortOrganizerExceptions,
  transitionExceptionHandling,
  type BuildOrganizerExceptionsInput,
  type ExceptionMemberSnapshot,
} from '../utils/organizerExceptions';

const NOW = '2026-07-25T12:00:00.000Z';
const EARLIER = '2026-07-25T11:55:00.000Z';
const LATER = '2026-07-25T12:05:00.000Z';

function member(
  overrides: Partial<ExceptionMemberSnapshot> & { userId: string },
): ExceptionMemberSnapshot {
  return {
    name: overrides.name ?? overrides.userId,
    role: 'follower',
    status: 'active',
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<BuildOrganizerExceptionsInput> = {},
): BuildOrganizerExceptionsInput {
  return {
    groupId: 'g1',
    nowIso: NOW,
    gatheringPoint: { id: 'dest-1', title: '北車' },
    navigationSessionId: 'sess-1',
    members: [
      member({ userId: 'leader', name: 'Leader', role: 'leader' }),
      member({ userId: 'a', name: 'Alice' }),
      member({ userId: 'b', name: 'Bob' }),
    ],
    leaderUserId: 'leader',
    ...overrides,
  };
}

describe('exceptionTypeFromNavStatus', () => {
  it('maps technical failure statuses to exception types', () => {
    expect(exceptionTypeFromNavStatus('location_disabled')).toBe('location_disabled');
    expect(exceptionTypeFromNavStatus('permission_denied')).toBe('location_disabled');
    expect(exceptionTypeFromNavStatus('sharing_disabled')).toBe('sharing_disabled');
    expect(exceptionTypeFromNavStatus('offline')).toBe('offline');
    expect(exceptionTypeFromNavStatus('app_force_quit_suspected')).toBe(
      'force_quit_suspected',
    );
  });

  it('never treats normal progress / ETA-like states as exceptions', () => {
    for (const s of [
      'pending',
      'activity_started',
      'tracking_active',
      'arriving',
      'arrived',
      'missed',
      'cancelled',
      'push_unavailable',
    ] as const) {
      expect(exceptionTypeFromNavStatus(s)).toBeNull();
    }
  });
});

describe('collectExceptionCandidates + buildOrganizerExceptions', () => {
  it('produces one normalized item per exception source with member + gathering context', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        navigationMemberStates: [
          {
            userId: 'a',
            localStatus: 'location_disabled',
            updatedAt: EARLIER,
          },
        ],
        stragglers: [{ userId: 'b', name: 'Bob', distanceM: 800, seenAt: NOW }],
        helpSignals: [{ userId: 'a', seenAt: LATER }],
        lateSignals: [{ userId: 'b', seenAt: NOW }],
      }),
    );

    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(
      ['late', 'location_disabled', 'needs_help', 'straggler'].sort(),
    );

    const help = items.find((i) => i.type === 'needs_help')!;
    expect(help.memberId).toBe('a');
    expect(help.memberName).toBe('Alice');
    expect(help.gatheringPointId).toBe('dest-1');
    expect(help.gatheringPointTitle).toBe('北車');
    expect(help.rootCauseKey).toBe(
      buildRootCauseKey('nav:sess-1', 'a', 'needs_help'),
    );
    expect(help.firstSeenAt).toBeTruthy();
    expect(help.lastSeenAt).toBe(LATER);
    expect(help.severity).toBeGreaterThan(0);
    expect(help.status).toBe('open');
    expect(help.availableActions).toEqual(['acknowledge', 'resolve']);
  });

  it('supports offline, sharing_disabled, and force_quit_suspected', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        navigationMemberStates: [
          {
            userId: 'a',
            localStatus: 'sharing_disabled',
            updatedAt: NOW,
          },
          {
            userId: 'b',
            localStatus: 'app_force_quit_suspected',
            updatedAt: NOW,
          },
        ],
        members: [
          member({ userId: 'leader', role: 'leader' }),
          member({ userId: 'a', name: 'Alice', status: 'offline' }),
          member({ userId: 'b', name: 'Bob' }),
        ],
      }),
    );
    expect(items.map((i) => i.type).sort()).toEqual(
      ['force_quit_suspected', 'offline', 'sharing_disabled'].sort(),
    );
  });

  it('dedupes same member/session/root-cause into one updatable item', () => {
    const input = baseInput({
      navigationMemberStates: [
        { userId: 'a', localStatus: 'offline', updatedAt: EARLIER },
        { userId: 'a', localStatus: 'offline', updatedAt: LATER },
      ],
      // membership offline for same member → same root cause
      members: [
        member({ userId: 'leader', role: 'leader' }),
        member({ userId: 'a', name: 'Alice', status: 'offline', lastUpdated: NOW }),
      ],
    });
    const candidates = collectExceptionCandidates(input);
    expect(candidates.filter((c) => c.type === 'offline').length).toBeGreaterThan(1);

    const sessionKey = buildSessionKey({
      groupId: 'g1',
      navigationSessionId: 'sess-1',
      destinationId: 'dest-1',
    });
    const deduped = dedupeExceptionCandidates(candidates, sessionKey);
    const offline = deduped.filter((c) => c.type === 'offline');
    expect(offline).toHaveLength(1);
    expect(offline[0].firstSeenAt).toBe(EARLIER);
    expect(offline[0].lastSeenAt).toBe(LATER);

    const items = buildOrganizerExceptions(input);
    expect(items.filter((i) => i.type === 'offline')).toHaveLength(1);
  });

  it('preserves firstSeen from prior observations when source updates', () => {
    const key = buildRootCauseKey('nav:sess-1', 'a', 'straggler');
    const items = buildOrganizerExceptions(
      baseInput({
        stragglers: [{ userId: 'a', name: 'Alice', distanceM: 900, seenAt: LATER }],
        priorItems: [
          { rootCauseKey: key, firstSeenAt: EARLIER, lastSeenAt: EARLIER },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].firstSeenAt).toBe(EARLIER);
    expect(items[0].lastSeenAt).toBe(LATER);
  });

  it('orders by severity then freshness, with stable rootCauseKey ties', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: EARLIER }], // severity 100
        stragglers: [
          { userId: 'a', name: 'Alice', distanceM: 600, seenAt: LATER }, // 50
          { userId: 'b', name: 'Bob', distanceM: 700, seenAt: LATER }, // 50 same freshness
        ],
        lateSignals: [{ userId: 'b', seenAt: NOW }], // 40
      }),
    );
    expect(items.map((i) => i.type)).toEqual([
      'needs_help',
      'straggler',
      'straggler',
      'late',
    ]);
    // Same severity + same lastSeen: stable by rootCauseKey
    const stragglers = items.filter((i) => i.type === 'straggler');
    expect(stragglers[0].rootCauseKey < stragglers[1].rootCauseKey).toBe(true);
  });

  it('sortOrganizerExceptions is stable for equal severity and time', () => {
    const sorted = sortOrganizerExceptions([
      { severity: 50, lastSeenAt: NOW, rootCauseKey: 'z' },
      { severity: 50, lastSeenAt: NOW, rootCauseKey: 'a' },
      { severity: 90, lastSeenAt: EARLIER, rootCauseKey: 'm' },
    ]);
    expect(sorted.map((s) => s.rootCauseKey)).toEqual(['m', 'a', 'z']);
  });

  it('does not create items from travel mode / ETA / ordinary progress inputs', () => {
    // No travelMode or eta fields exist on the API — only technical states
    // that represent normal progress should stay quiet.
    const items = buildOrganizerExceptions(
      baseInput({
        navigationMemberStates: [
          { userId: 'a', localStatus: 'tracking_active', updatedAt: NOW },
          { userId: 'b', localStatus: 'arriving', updatedAt: NOW },
          { userId: 'a', localStatus: 'activity_started', updatedAt: NOW },
        ],
        stragglers: [],
        helpSignals: [],
        lateSignals: [],
      }),
    );
    expect(items).toEqual([]);
  });

  it('leader can acknowledge and resolve without changing other state shapes', () => {
    const open = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: NOW }],
      }),
    );
    expect(open[0].status).toBe('open');

    let handling = transitionExceptionHandling({}, open[0].rootCauseKey, 'acknowledge', NOW);
    const acked = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: NOW }],
        handling,
      }),
    );
    expect(acked[0].status).toBe('acknowledged');
    expect(acked[0].availableActions).toEqual(['resolve', 'reopen']);

    handling = transitionExceptionHandling(handling, open[0].rootCauseKey, 'resolve', LATER);
    const resolvedHidden = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: NOW }],
        handling,
      }),
    );
    // Default workload list excludes resolved.
    expect(resolvedHidden).toHaveLength(0);

    const resolvedShown = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: NOW }],
        handling,
        includeResolved: true,
      }),
    );
    expect(resolvedShown[0].status).toBe('resolved');

    // transitionExceptionHandling only returns a map — no team phase mutation.
    expect(handling[open[0].rootCauseKey]).toEqual({
      status: 'resolved',
      updatedAt: LATER,
    });
  });

  it('resolving does not fabricate arrival or alter other members', () => {
    const membersBefore = baseInput().members;
    const handling = transitionExceptionHandling(
      {},
      buildRootCauseKey('nav:sess-1', 'a', 'needs_help'),
      'resolve',
      NOW,
    );
    const items = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: NOW }],
        handling,
        includeResolved: true,
      }),
    );
    expect(items[0].status).toBe('resolved');
    // Input members snapshot is unchanged by build/transition (pure).
    expect(baseInput().members).toEqual(membersBefore);
    expect(availableActionsFor('resolved')).toEqual(['reopen']);
  });

  it('uses navigation responses for late and needs_help when provided', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        navigationResponses: [
          { userId: 'a', response: 'late', updatedAt: NOW },
          { userId: 'b', response: 'needs_help', updatedAt: LATER },
          { userId: 'a', response: 'acknowledged', updatedAt: LATER },
        ],
      }),
    );
    expect(items.map((i) => i.type).sort()).toEqual(['late', 'needs_help'].sort());
  });

  it('skips late/straggler for members who already arrived', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        members: [
          member({ userId: 'leader', role: 'leader' }),
          member({ userId: 'a', name: 'Alice', arrived: true }),
        ],
        stragglers: [{ userId: 'a', name: 'Alice', distanceM: 900 }],
        lateSignals: [{ userId: 'a', seenAt: NOW }],
      }),
    );
    expect(items).toEqual([]);
  });

  it('suppresses location/sharing/offline after arrival but keeps force_quit and needs_help', () => {
    const items = buildOrganizerExceptions(
      baseInput({
        members: [
          member({ userId: 'leader', role: 'leader' }),
          member({ userId: 'a', name: 'Alice', arrived: true, status: 'offline' }),
        ],
        navigationMemberStates: [
          { userId: 'a', localStatus: 'location_disabled', updatedAt: NOW },
          { userId: 'a', localStatus: 'sharing_disabled', updatedAt: NOW },
          { userId: 'a', localStatus: 'app_force_quit_suspected', updatedAt: NOW },
        ],
        helpSignals: [{ userId: 'a', seenAt: NOW }],
      }),
    );
    expect(items.map((i) => i.type).sort()).toEqual(
      ['force_quit_suspected', 'needs_help'].sort(),
    );
  });

  it('auto-reopens resolved items when source evidence is fresher than handling', () => {
    const key = buildRootCauseKey('nav:sess-1', 'a', 'needs_help');
    const handling = {
      [key]: { status: 'resolved' as const, updatedAt: EARLIER },
    };
    const stillResolved = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: EARLIER }],
        handling,
        includeResolved: true,
      }),
    );
    expect(stillResolved[0].status).toBe('resolved');

    const reopened = buildOrganizerExceptions(
      baseInput({
        helpSignals: [{ userId: 'a', seenAt: LATER }],
        handling,
      }),
    );
    expect(reopened[0].status).toBe('open');
  });

  it('guards Date.parse failures in dedupe and sort', () => {
    expect(parseTimeMs('not-a-date')).toBeNull();
    expect(parseTimeMs(NOW)).toBe(Date.parse(NOW));

    const sessionKey = 'nav:sess-1';
    const deduped = dedupeExceptionCandidates(
      [
        {
          type: 'offline',
          memberId: 'a',
          memberName: 'Alice',
          lastSeenAt: 'bad',
        },
        {
          type: 'offline',
          memberId: 'a',
          memberName: 'Alice',
          lastSeenAt: LATER,
        },
      ],
      sessionKey,
      [],
      NOW,
    );
    expect(deduped).toHaveLength(1);
    expect(deduped[0].lastSeenAt).toBe(LATER);

    const sorted = sortOrganizerExceptions([
      { severity: 50, lastSeenAt: 'nope', rootCauseKey: 'z' },
      { severity: 50, lastSeenAt: NOW, rootCauseKey: 'a' },
    ]);
    expect(sorted[0].rootCauseKey).toBe('a');
  });

  it('mergePriorObservations retains firstSeen for handling keys when item hides', () => {
    const key = buildRootCauseKey('nav:sess-1', 'a', 'straggler');
    const merged = mergePriorObservations(
      [{ rootCauseKey: key, firstSeenAt: EARLIER, lastSeenAt: EARLIER }],
      [],
      [key],
    );
    expect(merged).toEqual([
      { rootCauseKey: key, firstSeenAt: EARLIER, lastSeenAt: EARLIER },
    ]);
  });

  it('resolveEffectiveHandling only reopens when lastSeen is strictly after handle', () => {
    expect(
      resolveEffectiveHandling(
        { status: 'resolved', updatedAt: NOW },
        EARLIER,
      ),
    ).toBe('resolved');
    expect(
      resolveEffectiveHandling(
        { status: 'resolved', updatedAt: EARLIER },
        LATER,
      ),
    ).toBe('open');
    expect(
      resolveEffectiveHandling({ status: 'acknowledged', updatedAt: EARLIER }, LATER),
    ).toBe('acknowledged');
  });
});

describe('lateSignalsFromMeetTime', () => {
  it('flags non-arrived followers only after meetAt', () => {
    const signals = lateSignalsFromMeetTime({
      meetAtIso: EARLIER,
      nowIso: NOW,
      members: [
        member({ userId: 'leader', role: 'leader' }),
        member({ userId: 'a', name: 'Alice' }),
        member({ userId: 'b', name: 'Bob', arrived: true }),
      ],
    });
    expect(signals.map((s) => s.userId)).toEqual(['a']);
  });

  it('uses stable overdue threshold as seenAt (not wall-clock now)', () => {
    const signalsT1 = lateSignalsFromMeetTime({
      meetAtIso: EARLIER,
      nowIso: NOW,
      members: [member({ userId: 'a' })],
    });
    const signalsT2 = lateSignalsFromMeetTime({
      meetAtIso: EARLIER,
      nowIso: LATER,
      members: [member({ userId: 'a' })],
    });
    expect(signalsT1[0].seenAt).toBe(EARLIER);
    expect(signalsT2[0].seenAt).toBe(EARLIER);
    expect(signalsT1[0].seenAt).toBe(signalsT2[0].seenAt);
  });

  it('keeps late resolved across clock ticks with identical membership', () => {
    const key = buildRootCauseKey('nav:sess-1', 'a', 'late');
    const lateSignals = lateSignalsFromMeetTime({
      meetAtIso: EARLIER,
      nowIso: NOW,
      members: [member({ userId: 'a', name: 'Alice' })],
    });
    const handling = {
      [key]: { status: 'resolved' as const, updatedAt: NOW },
    };
    // Rebuild with later nowIso — meet-time late seenAt stays at EARLIER.
    const lateLater = lateSignalsFromMeetTime({
      meetAtIso: EARLIER,
      nowIso: LATER,
      members: [member({ userId: 'a', name: 'Alice' })],
    });
    expect(lateLater[0].seenAt).toBe(lateSignals[0].seenAt);

    const items = buildOrganizerExceptions(
      baseInput({
        lateSignals: lateLater,
        handling,
        includeResolved: true,
        nowIso: LATER,
      }),
    );
    expect(items.find((i) => i.type === 'late')?.status).toBe('resolved');
  });

  it('returns empty when meet time is still in the future or missing', () => {
    expect(
      lateSignalsFromMeetTime({
        meetAtIso: LATER,
        nowIso: NOW,
        members: [member({ userId: 'a' })],
      }),
    ).toEqual([]);
    expect(
      lateSignalsFromMeetTime({
        meetAtIso: null,
        nowIso: NOW,
        members: [member({ userId: 'a' })],
      }),
    ).toEqual([]);
  });
});

describe('session + root cause keys', () => {
  it('prefers navigation session then destination then group', () => {
    expect(
      buildSessionKey({ groupId: 'g', navigationSessionId: 's', destinationId: 'd' }),
    ).toBe('nav:s');
    expect(buildSessionKey({ groupId: 'g', destinationId: 'd' })).toBe('dest:d');
    expect(buildSessionKey({ groupId: 'g' })).toBe('group:g');
  });
});
