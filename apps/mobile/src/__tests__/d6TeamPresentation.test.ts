import { getD6MemberStatus, getD6SubgroupPresentation } from '../screens/MapScreen/d6TeamPresentation';

test('location privacy takes priority over either visible presence mode', () => {
  expect(getD6MemberStatus('follow', false)).toBe('stealth');
  expect(getD6MemberStatus('solo', false)).toBe('stealth');
  expect(getD6MemberStatus('solo', true)).toBe('solo');
  expect(getD6MemberStatus('follow', true)).toBe('follow');
});

test('starts at teal and cycles subgroup colors in creation order across independent snapshots', () => {
  const teams = [
    { id: 'a-latest', createdAt: '2026-11-13T16:00:00Z' },
    { id: 'b-newer', createdAt: '2026-11-13T15:00:00Z' },
    { id: 'c-next', createdAt: '2026-11-13T14:00:00Z' },
    { id: 'd-first', createdAt: '2026-11-13T13:00:00Z' },
  ];
  const ordered = getD6SubgroupPresentation(teams);
  expect(ordered.map(item => item.subgroup.id)).toEqual(['d-first', 'c-next', 'b-newer', 'a-latest']);
  expect(ordered.map(item => item.color)).toEqual(['#4FD1C5', '#B794F4', '#F687B3', '#4FD1C5']);
  expect(getD6SubgroupPresentation(teams.slice().reverse())).toEqual(ordered);
});

test('gives cached data without a timestamp a deterministic order', () => {
  const teams = [{ id: 'b' }, { id: 'a' }, { id: 'c', createdAt: '2026-11-13T13:00:00Z' }];
  expect(getD6SubgroupPresentation(teams).map(item => item.subgroup.id)).toEqual(['a', 'b', 'c']);
});
