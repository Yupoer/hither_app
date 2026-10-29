const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');
const { catalog } = require('../../test/headless/actions.cjs');

describe('headless harness contract', () => {
  jest.setTimeout(90000);

  it('boots independent app processes with actor-bound storage and clean disposal', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      const b = await world.device({ id: 'b', userId: PEER });
      const first = await a.observe();
      const second = await b.observe();
      expect(first.actorId).toBe(LEADER);
      expect(second.actorId).toBe(PEER);
      expect(first.pid).not.toBe(second.pid);
    } finally { await world.close(); }
  });

  it('keeps recovery server time aligned with actor time during a long timer advance', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'clock', userId: LEADER });
      await device.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(device, (value: { group: { dataSource: string } }) => value.group.dataSource === 'remote');
      await world.advance(185_000);
      const observed = await device.observe();
      expect(observed.now).toBe(world.now);
      expect(observed.group.serverTimeOffsetMs).toBe(0);
      const snapshots = world.backend.trace.filter((call: { name: string }) => call.name === 'get_group_public_recovery_snapshot');
      expect(snapshots.length).toBeGreaterThan(1);
      expect(snapshots.at(-1).at).toBeLessThan(world.now);
      expect(Date.parse(snapshots.at(-1).result.data.generated_at)).toBe(snapshots.at(-1).at);
    } finally { await world.close(); }
  });

  it.each(['network', 'native', 'sdk'])('keeps a swallowed unexpected %s operation fatal through observation and disposal', async name => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      await expect(a.command({ kind: 'probe', name })).rejects.toThrow(/Forbidden real network|Unsupported/);
      await expect(a.observe()).rejects.toThrow(/Forbidden real network|Unsupported/);
      await expect(world.close()).rejects.toThrow(/Headless disposal failed/);
      expect(a.child).toBeNull();
    } finally { if (!world.closed) await world.close(); }
  });

  it('derives the callable catalog from the dispatch registry and rejects unknown actions', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      expect(catalog().map((entry: any) => entry.name)).toEqual(expect.arrayContaining([
        'group.observe', 'group.refresh', 'location.refresh', 'journey.start', 'journey.end', 'journey.stop',
        'destination.add', 'destination.delete', 'destination.reorder',
      ]));
      await expect(a.perform('not-an-action')).rejects.toThrow('Unsupported action');
      await expect(a.observe()).rejects.toThrow('Unsupported action');
      await expect(world.close()).rejects.toThrow('Sticky external failure');
      expect(a.child).toBeNull();
    } finally { if (!world.closed) await world.close(); }
  });

  it('kills only its own child when shutdown hangs and reports the missing disposal receipt', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      await a.command({ kind: 'probe', name: 'hangShutdown' });
      await expect(world.close()).rejects.toThrow(/close deadline/);
      expect(a.child).toBeNull();
      expect((await a.exited).signal).toBe('SIGTERM');
    } finally { if (!world.closed) await world.close(); }
  });

  it('reports an actor crash and reaps the owned process', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      a.child.kill();
      await a.exited;
      await expect(world.close()).rejects.toThrow(/Headless disposal failed/);
      expect(a.child).toBeNull();
    } finally { if (!world.closed) await world.close(); }
  });

  it('restores the replacement account from durable auth storage after device restart', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      await a.input({ kind: 'account', userId: PEER });
      expect((await a.observe()).actorId).toBe(PEER);
      await a.restart();
      expect((await a.observe()).actorId).toBe(PEER);
      expect(a.spec.userId).toBe(LEADER);
      await a.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.group.dataSource === 'remote', 'restored member context');
      await a.perform('journey.start', { destinationId: DESTINATION });
      await world.settle();
      const follower = await a.observe();
      expect(follower.journey.targetId).toBe(DESTINATION);
      expect(follower.group.state.group.journeyStatus).toBe('paused');
      expect(follower.durable.operations).toEqual([]);
    } finally { await world.close(); }
  });

  it('rolls back failed transactions in the real SQLite native-open bridge', async () => {
    const { open } = require('../../test/headless/sqlite.cjs');
    const db = open(':memory:');
    try {
      await db.execAsync('CREATE TABLE proof (value TEXT NOT NULL)');
      await expect(db.withExclusiveTransactionAsync(async (tx: any) => {
        await tx.runAsync('INSERT INTO proof(value) VALUES (?)', ['draft']);
        throw new Error('disk failure');
      })).rejects.toThrow('disk failure');
      expect(await db.getAllAsync('SELECT * FROM proof')).toEqual([]);
    } finally { await db.closeAsync(); }
  });

  it('releases a held external permission read during clean owned-process disposal', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.external.watches >= 2, 'startup location owners');
      await a.input({ kind: 'permissionRead', action: 'holdNext' });
      await a.gps(25.03, 121.53);
      await world.waitFor(a, (value: any) => value.external.heldPermissionReads === 1, 'held native permission result');
      await world.close();
      expect(a.disposal.heldPermissionReads).toBe(0);
      expect(a.disposal.watches).toBe(0);
      expect(a.disposal.pending).toBe(0);
      expect(a.child).toBeNull();
    } finally { await world.close(); }
  });

  it('finishes concurrent foreground transitions before unmounting the real native location owners', async () => {
    const world = new World();
    try {
      const a = await world.device({ id: 'a', userId: LEADER });
      await a.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(a, (value: any) => value.external.watches >= 2, 'native one-shot and continuous owners');
      const held = a.command({ kind: 'probe', name: 'holdActTurn' }).catch((error: Error) => error);
      expect((await a.observe()).external.heldActTurn).toBe(true);
      const transitions = Promise.all([
        a.command({ kind: 'barrier' }),
        a.input({ kind: 'appState', value: 'background' }),
        a.input({ kind: 'appState', value: 'active' }),
      ]).catch((error: Error) => error);
      const closing = world.close().catch((error: Error) => error);
      const released = await a.command({ kind: 'probe', name: 'releaseActTurn' }).catch((error: Error) => error);
      const closeOutcome = await closing;
      if (closeOutcome instanceof Error) throw closeOutcome;
      expect(released).not.toBeInstanceOf(Error);
      expect(await held).not.toBeInstanceOf(Error);
      expect(await transitions).not.toBeInstanceOf(Error);
      expect(a.disposal.watches).toBe(0);
      expect(a.disposal.listeners).toBe(0);
      expect(a.child).toBeNull();
    } finally { await world.close(); }
  });

});
export {};
