import React from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const { World } = require('../../test/headless/world.cjs');
const { LEADER, GROUP_ID } = require('../../test/headless/backend.cjs');
const SECOND = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
type Host = { testId?: string; selected?: boolean; disabled?: boolean; acceptsInput?: boolean };
type Observation = {
  presentation: {
    hosts: Host[];
    route: { route: string; params?: { groupId?: string }; routes: { name: string; params?: { groupId?: string } }[] };
    session: { membership: { group: { id: string } } | null };
  };
  external: { alerts: number; channels: number; listeners: number; watches: number };
  native: { listeners: { iap: number; notification: number; live: number }; location: { listeners: number }; ads: { listeners: number }[] };
  timers: number; pending: unknown[]; fatal: string[];
};
const host = (value: Observation, testId: string) => value.presentation.hosts.find(candidate => candidate.testId === testId);
function resources(value: Observation) {
  return { channels: value.external.channels, listeners: value.external.listeners, watches: value.external.watches,
    nativeListeners: value.native.listeners, nativeLocationListeners: value.native.location.listeners,
    adListeners: value.native.ads.reduce((sum, ad) => sum + ad.listeners, 0) };
}
jest.setTimeout(180000);

it('replaces Map through App settings 100 times without accumulating retired team resources', async () => {
  const world = new World();
  for (const [id, name] of [[SECOND, 'Second team'], [THIRD, 'Third team']]) {
    world.backend.groups.set(id, { ...world.backend.groups.get(GROUP_ID), id, name, invite_code: id.slice(0, 6) });
    world.backend.memberships.push({ group_id: id, user_id: LEADER, role: 'leader', status: 'active' });
  }
  world.backend.profiles.get(LEADER).preferences = { groupFeatureTourCompleted: true };
  let scenarioFailure: unknown;
  try {
    const device = await world.device({ id: 'team-switch-stress', userId: LEADER, platform: 'ios', mode: 'app' });
    const press = (testId: string) => device.host.call({ kind: 'press', testId });
    await world.waitFor(device, (value: Observation) => Boolean(host(value, `team-card-${GROUP_ID}`)), 'team entry');
    await device.perform('teams.enter', { groupId: GROUP_ID });
    await world.waitFor(device, (value: Observation) => Boolean(host(value, 'home-profile')), 'initial Map');
    const plateau = new Map<string, ReturnType<typeof resources>>();
    const timerPlateau = new Map<string, number>();
    const targets = [SECOND, THIRD, GROUP_ID];
    for (let index = 0; index < 100; index++) {
      const target = targets[index % targets.length];
      const before: Observation = await device.observe();
      await press('home-profile');
      await device.input({ kind: 'animation', finished: true });
      await world.waitFor(device, (value: Observation) => Boolean(host(value, 'settings-page-teams')), 'settings entry');
      await press('settings-page-teams');
      await world.waitFor(device, (value: Observation) => Boolean(host(value, `settings-team-card-${target}`)), 'team picker');
      expect(host(await device.observe(), 'settings-team-confirm')).toBeUndefined();
      await press(`settings-team-card-${target}`);
      const selected: Observation = await device.observe();
      expect(selected.presentation.session.membership?.group.id).toBe(before.presentation.session.membership?.group.id);
      expect(selected.presentation.route.params?.groupId).toBe(before.presentation.route.params?.groupId);
      expect(host(selected, `settings-team-card-${target}`)?.selected).toBe(false);
      expect(selected.external.alerts).toBe(1);
      if (index === 0) {
        await device.input({ kind: 'alert', index: 0 });
        const canceled: Observation = await device.observe();
        expect(canceled.presentation.session.membership?.group.id).toBe(before.presentation.session.membership?.group.id);
        expect(canceled.presentation.route.params?.groupId).toBe(before.presentation.route.params?.groupId);
        expect(canceled.external.alerts).toBe(0);
        await press(`settings-team-card-${target}`);
      }
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: Observation) => value.presentation.session.membership?.group.id === target
        && value.presentation.route.params?.groupId === target && !host(value, 'settings-team-confirm')
        && Boolean(host(value, 'home-profile')), `fresh Map switch ${index + 1}`);
      await world.settle(); await world.advance(1000);
      const after: Observation = await device.observe();
      expect(after.presentation.route.routes.filter(route => route.name === 'Map')).toEqual([{ name: 'Map', params: { groupId: target } }]);
      expect(after.pending).toEqual([]); expect(after.fatal).toEqual([]);
      expect(host(after, 'settings-child-back')).toBeUndefined();
      if (index < 6) { plateau.set(target, resources(after)); timerPlateau.set(target, after.timers); }
      else { expect(resources(after)).toEqual(plateau.get(target)); expect(after.timers).toBeLessThanOrEqual(timerPlateau.get(target) ?? -1); }
    }
  } catch (error) {
    scenarioFailure = error;
    throw error;
  } finally {
    try { await world.close(); } catch (error) {
      if (scenarioFailure) throw new AggregateError([scenarioFailure, error], `Team switch assertion failed: ${String(scenarioFailure)}; disposal failed: ${String(error)}`);
      throw error;
    }
  }
});

it('gives same-name replace a new Map lifetime in the App navigation fixture', () => {
  const { installNavigation } = require('../../test/headless/app.cjs');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  type Stack = {
    Navigator: React.ComponentType<{ initialRouteName: string; children?: React.ReactNode }>;
    Screen: React.ComponentType<{ name: string; component: React.ComponentType; initialParams: { groupId: string } }>;
  };
  let stack: Stack | undefined;
  const host: { navigation?: { replace: (name: string, params: { groupId: string }) => void }; route?: { routes: { name: string }[] } } = {};
  installNavigation({ host, jest: { doMock: (name: string, factory: () => { createNativeStackNavigator?: () => Stack }) => {
    const module = factory();
    if (name === '@react-navigation/native-stack') stack = module.createNativeStackNavigator?.();
  } } });
  if (!stack) throw new Error('Navigation fixture did not register a stack');
  let mounts = 0;
  let unmounts = 0;
  function Map() {
    useMountEffect(() => { mounts++; return () => { unmounts++; }; });
    return null;
  }
  const { Navigator, Screen } = stack;
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(React.createElement(Navigator, { initialRouteName: 'Map' },
    React.createElement(Screen, { name: 'Map', component: Map, initialParams: { groupId: GROUP_ID } })));
  });
  try {
    expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
    act(() => renderer.update(React.createElement(Navigator, { initialRouteName: 'Map' },
      React.createElement(Screen, { name: 'Map', component: Map, initialParams: { groupId: GROUP_ID } }))));
    expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
    for (const [index, groupId] of [SECOND, THIRD, GROUP_ID].entries()) {
      act(() => host.navigation?.replace('Map', { groupId }));
      expect({ mounts, unmounts }).toEqual({ mounts: index + 2, unmounts: index + 1 });
      expect(host.route?.routes).toHaveLength(1);
    }
  } finally { act(() => renderer.unmount()); }
  expect(mounts).toBe(unmounts);
});
