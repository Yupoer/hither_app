import { newlyCompletedVisibleCards } from '../utils/arrivalCardExit';
import { claimAppNotice, clearAppNotices, showAppNotice, subscribeAppNotices } from '../state/appNotice';

afterEach(clearAppNotices);

it('does not reinsert completed history during initial hydration or map reentry', () => {
  const historical = [{ id: 'old' }];
  expect(newlyCompletedVisibleCards(historical, null, [], true)).toEqual([]);
  expect(newlyCompletedVisibleCards(historical, new Set(), ['old'], false)).toEqual([]);
  expect(newlyCompletedVisibleCards(historical, new Set(['old']), ['old'], true)).toEqual([]);
  expect(newlyCompletedVisibleCards(historical, new Set(), ['new'], true)).toEqual([]);
  expect(newlyCompletedVisibleCards([{ id: 'new' }, ...historical], new Set(['old']), ['new'], true))
    .toEqual([{ id: 'new' }]);
});

it('claims a terminal error once without publishing a retry banner', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeAppNotices(listener);
  expect(claimAppNotice('rejected-operation')).toBe(true);
  expect(claimAppNotice('rejected-operation')).toBe(false);
  showAppNotice({ id: 'rejected-operation', title: 'duplicate' });
  expect(listener.mock.calls).toEqual([[null]]);
  for (let index = 0; index < 501; index += 1) claimAppNotice(`other-${index}`);
  expect(claimAppNotice('rejected-operation')).toBe(true);
  clearAppNotices();
  expect(claimAppNotice('rejected-operation')).toBe(true);
  unsubscribe();
});
